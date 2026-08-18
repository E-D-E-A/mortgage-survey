// One-off: publish the worked A/B + quotas questionnaire as a real survey so the
// console has draws, quotas and a flow graph to photograph for the guides.
import postgres from 'postgres';
import { abQuotasDemo } from '../src/questionnaire/ab-quotas-demo';

const sql = postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', { onnotice: () => {} });
const SLUG = 'ab-demo';
const VERSION = '2026-08-18.1-ab-demo';

await sql`insert into surveys (slug, name, created_by) values (${SLUG}, 'הדגמה — A/B ומכסות', 'docs')
          on conflict (slug) do update set name = excluded.name`;
await sql`insert into survey_drafts (survey_id, config, updated_by)
          values (${SLUG}, ${sql.json(abQuotasDemo as never)}, 'docs')
          on conflict (survey_id) do update set config = excluded.config, updated_at = now()`;
await sql.begin(async (tx) => {
  await tx`select pg_advisory_xact_lock(732913)`;
  await tx`alter table survey_configs disable trigger survey_configs_immutable`;
  await tx`delete from survey_configs where survey_id = ${SLUG}`;
  await tx`insert into survey_configs (version, survey_id, config, published_by)
           values (${VERSION}, ${SLUG}, ${tx.json({ ...abQuotasDemo, version: VERSION } as never)}, 'docs')`;
  await tx`alter table survey_configs enable trigger survey_configs_immutable`;
});
console.log('seeded', SLUG, VERSION, '· screens:', abQuotasDemo.screens.length);
await sql.end();
