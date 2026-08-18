// ENG-19-AC11 / ENG-20-AC7: validateConfig is the single source of validation
// truth, shared by the console and the publish endpoint.
//
// The console runs it for live feedback, which is advice. This endpoint runs it
// as a gate, which is enforcement — and enforcement is the half that had no test.
// Nothing proved a broken survey is actually refused, so a publish path that
// skipped the check, or grew rules of its own, would have passed the whole suite.
//
// The assertions below compare the endpoint's answer against validateConfig's own
// output rather than against a hand-written list. That is what makes them a test
// of "the same validation" instead of merely "some validation".
//
// Runs only with DB_TESTS=1 against the local stack.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applySchema,
  connectLocal,
  createAdminUser,
  dbTestsEnabled,
  LOCAL_API_URL,
  LOCAL_SERVICE_ROLE_KEY,
  signIn,
  type Sql,
} from './harness';
import { validateConfig } from '../../src/engine/validate';
import type { SurveyConfig } from '../../src/engine/types';

const SLUG = 'pubtest';

/** A marking rule that assigns a draw — an error, and one only the shared validator knows about. */
const broken: SurveyConfig = {
  version: 'draft',
  randomVars: { price: [99, 199] },
  screens: [
    { id: 'a', type: 'info', title: 'שאלה', body: '', onSubmit: [{ var: 'price', value: 5 }] },
    { id: 'e', type: 'end', variant: 'complete', title: 'תודה', body: '' },
  ],
};

/** A quota nothing sets, and a quota-full screen nothing routes to: warnings, no errors. */
const warned: SurveyConfig = {
  version: 'draft',
  varMeta: { persona: { label: 'פרסונה', quotas: { young_couple: 50 } } },
  screens: [
    { id: 'a', type: 'info', title: 'שלום', body: '' },
    { id: 'e', type: 'end', variant: 'complete', title: 'תודה', body: '' },
    { id: 'qf', type: 'end', variant: 'quotafull', title: 'המכסה מלאה', body: '' },
  ],
};

const clean: SurveyConfig = {
  version: 'draft',
  screens: [
    { id: 'a', type: 'info', title: 'שלום', body: '' },
    { id: 'e', type: 'end', variant: 'complete', title: 'תודה', body: '' },
  ],
};

const errorsOf = (cfg: SurveyConfig) => validateConfig(cfg).filter((i) => i.level === 'error');
const warningsOf = (cfg: SurveyConfig) => validateConfig(cfg).filter((i) => i.level === 'warning');

describe.runIf(dbTestsEnabled)('admin-publish is the validation gate (ENG-19 · ENG-20)', () => {
  let sql: Sql;
  let token: string;

  const publish = async (auth?: string) => {
    const { default: handler } = await import('../../netlify/functions/admin-publish.mts');
    const headers: Record<string, string> = auth ? { Authorization: `Bearer ${auth}` } : {};
    return handler(
      new Request(`http://localhost/.netlify/functions/admin-publish?survey=${SLUG}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      }),
    );
  };

  const setDraft = (config: SurveyConfig) =>
    sql`insert into survey_drafts (survey_id, config, updated_by)
        values (${SLUG}, ${sql.json(config as unknown as Parameters<Sql['json']>[0])}, 'test')
        on conflict (survey_id) do update set config = excluded.config, updated_at = now()`;

  /** survey_configs is append-only in production; a fixture needs to start empty. */
  const clearPublished = () =>
    sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(732913)`;
      await tx`alter table survey_configs disable trigger survey_configs_immutable`;
      await tx`delete from survey_configs where survey_id = ${SLUG}`;
      await tx`alter table survey_configs enable trigger survey_configs_immutable`;
    });

  const publishedVersions = async (): Promise<string[]> => {
    const rows = await sql`select version from survey_configs where survey_id = ${SLUG}`;
    return rows.map((r) => r.version as string);
  };

  beforeAll(async () => {
    process.env.SUPABASE_URL = LOCAL_API_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;
    sql = connectLocal();
    await applySchema(sql);
    await sql`insert into surveys (slug, name, created_by)
              values (${SLUG}, 'שאלון פרסום', 'test') on conflict (slug) do nothing`;
    await createAdminUser('publish-admin@first-edea.com');
    await createAdminUser('publish-outsider@gmail.com');
    token = await signIn('publish-admin@first-edea.com');
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('refuses a draft that does not validate, and publishes nothing', async () => {
    await clearPublished();
    await setDraft(broken);

    const res = await publish(token);

    expect(res.status).toBe(422);
    expect(await publishedVersions()).toEqual([]);
  });

  it('hands back exactly the errors validateConfig reports — not a second opinion', async () => {
    // The point of the ticket: one validator, shared. If the endpoint ever grew
    // rules of its own, or dropped one, these two lists would stop matching.
    await clearPublished();
    await setDraft(broken);

    const body = (await (await publish(token)).json()) as { errors: unknown; warnings: unknown };

    expect(body.errors).toEqual(errorsOf(broken));
    expect(errorsOf(broken).length).toBeGreaterThan(0);
  });

  it('publishes a clean draft and records the version', async () => {
    await clearPublished();
    await setDraft(clean);

    const res = await publish(token);
    const body = (await res.json()) as { version: string; warnings: unknown[] };

    expect(res.status).toBe(200);
    expect(body.warnings).toEqual([]);
    expect(await publishedVersions()).toEqual([body.version]);
    // The version is stamped into the config that was stored, not just returned
    const [row] = await sql`select config from survey_configs where version = ${body.version}`;
    expect((row.config as SurveyConfig).version).toBe(body.version);
  });

  it('lets warnings through, and returns them for the admin to read', async () => {
    // A warning is advice, not a blocker — publishing a survey with a dead quota
    // has to stay possible, or a researcher cannot ship a draft mid-design.
    await clearPublished();
    await setDraft(warned);

    const res = await publish(token);
    const body = (await res.json()) as { version: string; warnings: unknown };

    expect(res.status).toBe(200);
    expect(body.warnings).toEqual(warningsOf(warned));
    expect(warningsOf(warned).length).toBeGreaterThan(0);
    expect(await publishedVersions()).toEqual([body.version]);
  });

  it('only a first-edea editor may publish at all', async () => {
    await clearPublished();
    await setDraft(clean);

    expect((await publish()).status).toBe(401);
    expect((await publish(await signIn('publish-outsider@gmail.com'))).status).toBe(403);
    expect(await publishedVersions()).toEqual([]);
  });

  it('a survey with no draft has nothing to publish', async () => {
    await clearPublished();
    await sql`delete from survey_drafts where survey_id = ${SLUG}`;

    expect((await publish(token)).status).toBe(404);
  });
});
