// Packs the MCP server into a one-click Claude Desktop extension (.mcpb).
//
// The point: a teammate installs by double-clicking the file in Claude
// Desktop (Settings → Extensions) — no CLI, no Node install (Desktop ships
// its own runtime), no env editing. The cloud endpoints are baked into the
// bundle's manifest at pack time, so "install" and "works" are the same step;
// the only thing left for the teammate is the Google login on first use.
//
// Usage (a developer runs this, then shares the .mcpb file):
//   node scripts/pack-mcpb.mjs
//
// The baked values come from, in order: SURVEY_* env vars, then the repo's
// .env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — the same public values
// the console ships to every browser). SURVEY_API_URL defaults to the
// production site. Everything baked here is public by design; the bundle
// contains no secret of any kind.

// execSync (a shell) rather than execFileSync: npm/npx are .cmd shims on
// Windows and need one. Every interpolated value below is derived from this
// script's own location — no user input ever reaches a command line.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'tools', 'mcp-server');
const stageDir = join(pkgDir, '.mcpb-stage');
const outFile = join(pkgDir, 'mortgage-survey.mcpb');

function fromDotEnv(name) {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return undefined;
  const match = readFileSync(envPath, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match ? match[1].trim() : undefined;
}

const apiUrl = process.env.SURVEY_API_URL ?? 'https://mortgage-survey.netlify.app';
const supabaseUrl = process.env.SURVEY_SUPABASE_URL ?? fromDotEnv('VITE_SUPABASE_URL');
const anonKey = process.env.SURVEY_SUPABASE_ANON_KEY ?? fromDotEnv('VITE_SUPABASE_ANON_KEY');

if (!supabaseUrl || !anonKey) {
  console.error(
    'Missing Supabase values. Set SURVEY_SUPABASE_URL and SURVEY_SUPABASE_ANON_KEY, ' +
      'or have VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env (cloud values, not the local stack).',
  );
  process.exit(1);
}

// A teammate bundle pointing at localhost is a support ticket in a file.
// Local testing of the server itself never needs a bundle — that is what
// `claude mcp add` with no env is for.
const local = [apiUrl, supabaseUrl].filter((u) => /localhost|127\.0\.0\.1/.test(u));
if (local.length > 0 && process.env.MCPB_ALLOW_LOCAL !== '1') {
  console.error(
    `Refusing to bake local URLs into a shareable bundle: ${local.join(', ')}\n` +
      'Point SURVEY_API_URL / SURVEY_SUPABASE_URL at the cloud, or set MCPB_ALLOW_LOCAL=1 on purpose.',
  );
  process.exit(1);
}

console.log(`packing with:\n  api      = ${apiUrl}\n  supabase = ${supabaseUrl}`);

execSync('npm run mcp:build', { cwd: root, stdio: 'inherit' });

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, 'dist'), { recursive: true });
copyFileSync(join(pkgDir, 'dist', 'index.mjs'), join(stageDir, 'dist', 'index.mjs'));

const manifest = {
  manifest_version: '0.2',
  name: 'mortgage-survey',
  display_name: 'עריכת שאלונים — E.D.E.A',
  version: '0.1.0',
  description: 'עריכת טיוטות של שאלוני המחקר בשפה חופשית — הצעה, אישור, החלה וסימולציה',
  author: { name: 'E.D.E.A' },
  server: {
    type: 'node',
    entry_point: 'dist/index.mjs',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/dist/index.mjs'],
      env: {
        SURVEY_API_URL: apiUrl,
        SURVEY_SUPABASE_URL: supabaseUrl,
        SURVEY_SUPABASE_ANON_KEY: anonKey,
      },
    },
  },
};
writeFileSync(join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

execSync(`npx --yes @anthropic-ai/mcpb validate "${join(stageDir, 'manifest.json')}"`, {
  stdio: 'inherit',
});
execSync(`npx --yes @anthropic-ai/mcpb pack "${stageDir}" "${outFile}"`, { stdio: 'inherit' });
rmSync(stageDir, { recursive: true, force: true });

console.log(`\ndone: ${outFile}`);
console.log('Share this file; teammates install it in Claude Desktop → Settings → Extensions.');
