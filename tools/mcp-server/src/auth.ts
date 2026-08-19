// Sign-in for the MCP server: the same Google-via-Supabase login as the admin
// console, run once in the teammate's browser (PKCE + a local loopback
// redirect), with the session cached in a user-only file and refreshed
// silently from then on.
//
// The security posture, spelled out:
//   - the process holds the PUBLIC anon key only — it powers Supabase Auth and
//     grants no data access (the same key already ships in the console's JS);
//   - the service_role key is never present here, in any form;
//   - tokens are never accepted as tool arguments and never sent anywhere
//     except the app's own Netlify functions (no token passthrough);
//   - there is no shared or fallback credential: no session ⇒ a browser login
//     for THIS teammate's account, or a structured error.
//
// requireAdmin on the server treats these tokens exactly like the console's —
// same domain check, same revocation story (delete/ban the user in Supabase).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

const LOGIN_TIMEOUT_MS = 180_000;

/** Login failed or was abandoned — the tool call reports this as a structured auth error. */
export class AuthRequiredError extends Error {}

/**
 * supabase-js session storage backed by a single JSON file. 0600/0700 perms
 * are applied best-effort: meaningful on POSIX, mostly a no-op on Windows
 * (where the user-profile ACL already restricts the directory).
 */
class FileStorage {
  private cache: Record<string, string> | null = null;

  constructor(private readonly file: string) {}

  private load(): Record<string, string> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private save(): void {
    const dir = dirname(this.file);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    writeFileSync(this.file, JSON.stringify(this.load()), { encoding: 'utf8', mode: 0o600 });
    try {
      chmodSync(this.file, 0o600);
    } catch {
      /* Windows: chmod is approximate; the profile ACL is the real fence */
    }
  }

  getItem(key: string): string | null {
    return this.load()[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.load()[key] = value;
    this.save();
  }

  removeItem(key: string): void {
    delete this.load()[key];
    this.save();
  }
}

function openBrowser(url: string): void {
  // win32 does NOT go through `cmd /c start`: cmd splits an unquoted command
  // line at every `&`, and an OAuth authorize URL is full of them — the
  // browser would open a truncated URL with no code_challenge. rundll32's
  // FileProtocolHandler takes the URL as a real argv element, ampersands and
  // all.
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* the timeout error below includes the URL for opening by hand */
  }
}

/** The Hebrew page the browser lands on after the redirect — the only UI this server has. */
function landingPage(ok: boolean): string {
  const body = ok
    ? '<h1>ההתחברות הצליחה</h1><p>אפשר לסגור את הלשונית ולחזור לשיחה עם קלוד.</p>'
    : '<h1>ההתחברות נכשלה</h1><p>סגרו את הלשונית ונסו שוב מהשיחה. אם זה חוזר — ודאו שנכנסתם עם חשבון first-edea.com.</p>';
  return `<!doctype html><html dir="rtl" lang="he"><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;margin-top:4rem">${body}</body></html>`;
}

export interface AuthOptions {
  supabaseUrl: string;
  anonKey: string;
  /** The loopback port — must be allowlisted in Supabase Auth → Redirect URLs */
  loginPort: number;
  /** Where the session is cached */
  authFile: string;
  log: (line: string) => void;
}

export class AuthManager {
  private readonly supabase: SupabaseClient;
  /** A login already in flight — a second tool call must join it, not open a second browser */
  private pendingLogin: Promise<void> | null = null;

  constructor(private readonly opts: AuthOptions) {
    this.supabase = createClient(opts.supabaseUrl, opts.anonKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: new FileStorage(opts.authFile),
      },
    });
  }

  /** The cached session's token, refreshed when close to expiry; null when there is no usable session. */
  private async cachedToken(): Promise<string | null> {
    const {
      data: { session },
    } = await this.supabase.auth.getSession();
    if (!session) return null;
    const msLeft = (session.expires_at ?? 0) * 1000 - Date.now();
    if (msLeft > 60_000) return session.access_token;
    const { data, error } = await this.supabase.auth.refreshSession();
    if (error || !data.session) return null;
    return data.session.access_token;
  }

  /**
   * A valid token, running the browser login when the cache is empty or dead.
   * Concurrent callers share one login — one browser tab, not five.
   */
  async token(): Promise<string> {
    const cached = await this.cachedToken();
    if (cached) return cached;

    this.pendingLogin ??= this.login().finally(() => {
      this.pendingLogin = null;
    });
    await this.pendingLogin;

    const fresh = await this.cachedToken();
    if (!fresh) {
      throw new AuthRequiredError('login finished without a usable session');
    }
    return fresh;
  }

  /** Drops the cached session — after a 401 the next call starts a fresh login. */
  async reset(): Promise<void> {
    await this.supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }

  private async login(): Promise<void> {
    const { loginPort, log } = this.opts;
    const redirectTo = `http://127.0.0.1:${loginPort}/callback`;

    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', (err) =>
        reject(
          new AuthRequiredError(
            `לא ניתן לפתוח את פורט ההתחברות ${loginPort} (${(err as Error).message}) — ` +
              `ודאו שאין עוד עותק של השרת רץ, או קבעו פורט אחר ב-SURVEY_MCP_LOGIN_PORT`,
          ),
        ),
      );
      server.listen(loginPort, '127.0.0.1', resolve);
    });

    try {
      const { data, error } = await this.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error || !data?.url) {
        throw new AuthRequiredError(`יצירת קישור ההתחברות נכשלה: ${error?.message ?? 'unknown'}`);
      }

      log(`opening browser for Google sign-in: ${data.url}`);
      openBrowser(data.url);

      const code = await this.waitForCode(server, data.url);
      const { error: exchangeError } = await this.supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        throw new AuthRequiredError(`החלפת קוד ההתחברות נכשלה: ${exchangeError.message}`);
      }
      log('signed in; session cached');
    } finally {
      server.close();
    }
  }

  /** Resolves with the ?code= the loopback redirect delivers, or rejects on error/timeout. */
  private waitForCode(server: Server, loginUrl: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new AuthRequiredError(
            `ההתחברות לא הושלמה בתוך ${LOGIN_TIMEOUT_MS / 1000} שניות. ` +
              `אם הדפדפן לא נפתח, פתחו ידנית את הקישור: ${loginUrl}`,
          ),
        );
      }, LOGIN_TIMEOUT_MS);

      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get('code');
        const errorDescription =
          url.searchParams.get('error_description') ?? url.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(landingPage(Boolean(code)));
        clearTimeout(timer);
        if (code) resolve(code);
        else reject(new AuthRequiredError(`ההתחברות נדחתה: ${errorDescription ?? 'no code returned'}`));
      });
    });
  }
}
