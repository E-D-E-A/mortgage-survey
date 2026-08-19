// ENG-32: the console's door onto published versions.
//
// A published version is frozen — survey_configs carries an immutability
// trigger, and the collected answers refer to these rows. This endpoint is the
// only thing that hands one to the console, so the properties worth proving are
// the ones that keep it a reader: it serves nothing but GET, and it never
// returns a version belonging to a different survey.
//
// The ordering test earns its place separately. VersionsDialog trusts the
// server's order completely — versions[0] is labelled "פעילה" and versions[1]
// "הקודמת", with no client-side sort — so an ORDER BY that regressed would
// mislabel an old version as live in the console with no error anywhere.
//
// Runs only with DB_TESTS=1 against the local stack.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applySchema,
  connectLocal,
  createAdminUser,
  dbTestsEnabled,
  signIn,
  type Sql,
} from './harness';
import { MAX_VERSION_CHARS } from '../../src/data/surveys';
import type { SurveyConfig } from '../../src/engine/types';

const SLUG = 'vertest';
const OTHER = 'vertest2';

const config = (title: string): SurveyConfig => ({
  version: 'draft',
  screens: [
    { id: 'intro', type: 'info', title, body: '' },
    { id: 'e', type: 'end', variant: 'complete', title: 'תודה', body: '' },
  ],
});

describe.runIf(dbTestsEnabled)('admin-versions serves frozen versions, read-only (ENG-32)', () => {
  let sql: Sql;
  let token: string;

  const request = async (query: string, method = 'GET', auth?: string) => {
    const { default: handler } = await import('../../netlify/functions/admin-versions.mts');
    const headers: Record<string, string> = auth ? { Authorization: `Bearer ${auth}` } : {};
    return handler(
      new Request(`http://localhost/.netlify/functions/admin-versions${query}`, {
        method,
        headers,
      }),
    );
  };

  const seedVersion = (slug: string, version: string, publishedAt: string, title: string) =>
    sql`insert into survey_configs (version, survey_id, config, published_at, published_by)
        values (${version}, ${slug},
                ${sql.json(config(title) as unknown as Parameters<Sql['json']>[0])},
                ${publishedAt}, 'test')`;

  const clearPublished = (slug: string) =>
    sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(732914)`;
      await tx`alter table survey_configs disable trigger survey_configs_immutable`;
      await tx`delete from survey_configs where survey_id = ${slug}`;
      await tx`alter table survey_configs enable trigger survey_configs_immutable`;
    });

  beforeAll(async () => {
    sql = connectLocal();
    await applySchema(sql);
    await createAdminUser('versions@first-edea.com');
    token = await signIn('versions@first-edea.com');

    for (const slug of [SLUG, OTHER]) {
      await sql`insert into surveys (slug, name, created_by) values (${slug}, ${slug}, 'test')
                on conflict (slug) do nothing`;
      await clearPublished(slug);
    }

    // Inserted oldest-last on purpose: if the endpoint ever leaned on insertion
    // order instead of published_at, this fixture would expose it.
    await seedVersion(SLUG, '2026-08-05.1-vertest', '2026-08-05T10:00:00Z', 'ישן');
    await seedVersion(SLUG, '2026-08-09.1-vertest', '2026-08-09T10:00:00Z', 'חדש');
    await seedVersion(SLUG, '2026-08-07.1-vertest', '2026-08-07T10:00:00Z', 'אמצע');
    await seedVersion(OTHER, '2026-08-08.1-vertest2', '2026-08-08T10:00:00Z', 'של שאלון אחר');
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  it('lists a survey’s versions newest first', async () => {
    const res = await request(`?survey=${SLUG}`, 'GET', token);
    expect(res.status).toBe(200);
    const { versions } = (await res.json()) as { versions: { version: string }[] };
    expect(versions.map((v) => v.version)).toEqual([
      '2026-08-09.1-vertest',
      '2026-08-07.1-vertest',
      '2026-08-05.1-vertest',
    ]);
  });

  it('returns one version with its config', async () => {
    const res = await request(`?survey=${SLUG}&version=2026-08-05.1-vertest`, 'GET', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; config: SurveyConfig };
    expect(body.version).toBe('2026-08-05.1-vertest');
    expect(body.config.screens[0]).toMatchObject({ id: 'intro', title: 'ישן' });
  });

  // The one that protects a survey's content from leaking into another's
  // console view — and, through restore, into another's draft.
  it('refuses a version that belongs to a different survey', async () => {
    const res = await request(`?survey=${SLUG}&version=2026-08-08.1-vertest2`, 'GET', token);
    expect(res.status).toBe(404);
  });

  it('404s an unknown version', async () => {
    const res = await request(`?survey=${SLUG}&version=nope`, 'GET', token);
    expect(res.status).toBe(404);
  });

  // Read-only by construction: there is no write path to reach.
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses %s', async (method) => {
    const res = await request(`?survey=${SLUG}`, method, token);
    expect(res.status).toBe(405);
  });

  it('requires a signed-in editor', async () => {
    const res = await request(`?survey=${SLUG}`);
    expect(res.status).toBe(401);
  });

  it('rejects a malformed survey slug, and a missing one', async () => {
    expect((await request('?survey=Bad Slug', 'GET', token)).status).toBe(400);
    expect((await request('', 'GET', token)).status).toBe(400);
  });

  // The cap has to match what admin-publish can actually produce: a 40-char
  // slug plus a 40-char Hebrew label reaches into the 90s, and a reader with a
  // smaller cap would reject exactly the versions carrying a description.
  it('accepts a version name as long as the publisher can build, and rejects longer', async () => {
    expect((await request(`?survey=${SLUG}&version=`, 'GET', token)).status).toBe(400);
    const longest = 'v'.repeat(MAX_VERSION_CHARS);
    expect((await request(`?survey=${SLUG}&version=${longest}`, 'GET', token)).status).toBe(404);
    const tooLong = 'v'.repeat(MAX_VERSION_CHARS + 1);
    expect((await request(`?survey=${SLUG}&version=${tooLong}`, 'GET', token)).status).toBe(400);
  });

  it('returns an empty list for a survey that has never been published', async () => {
    await sql`insert into surveys (slug, name, created_by) values ('vernone', 'vernone', 'test')
              on conflict (slug) do nothing`;
    const res = await request('?survey=vernone', 'GET', token);
    expect(res.status).toBe(200);
    expect((await res.json()) as { versions: unknown[] }).toEqual({ versions: [] });
  });
});
