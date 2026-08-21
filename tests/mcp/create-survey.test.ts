// create_survey: the one survey-management verb the MCP toolset has. The point
// of the tool is that a survey can be brought into being and then filled in
// without a manual step in the console, so the test that matters is the whole
// arc — create, then edit the skeleton it produced.

import { afterEach, describe, expect, it } from 'vitest';
import { connectHarness, type McpHarness } from './helpers';
import { baseConfig } from './fixtures';

describe('create_survey', () => {
  let harness: McpHarness;

  afterEach(async () => {
    await harness.close();
  });

  it('creates a survey with a skeleton draft that propose_change can build on', async () => {
    harness = await connectHarness();
    const { api, callTool } = harness;

    const created = await callTool<{ slug: string; name: string; draft_updated_at: string }>(
      'create_survey',
      { survey: 'personas2', name: 'שאלון שתי פרסונות' },
    );
    expect(created.isError).toBe(false);
    expect(created.structured.slug).toBe('personas2');
    expect(created.structured.name).toBe('שאלון שתי פרסונות');
    expect(created.structured.draft_updated_at).toBeTruthy();

    // It exists in the listing, under its real name, already carrying a draft
    const list = await callTool<{ surveys: { slug: string; name: string; has_draft: boolean }[] }>(
      'list_surveys',
    );
    expect(list.structured.surveys).toMatchObject([
      { slug: 'personas2', name: 'שאלון שתי פרסונות', has_draft: true },
    ]);

    // The skeleton is a real, loadable draft — not an empty row
    const draft = await callTool<{ updated_at: string; outline: string }>('get_draft', {
      survey: 'personas2',
    });
    expect(draft.isError).toBe(false);
    expect(draft.structured.updated_at).toBe(created.structured.draft_updated_at);
    expect(draft.structured.outline).toContain('מסכים (2):');

    // The revision token the create returned is the one propose_change accepts,
    // so no get_draft round trip is needed between creating and filling in.
    const proposal = await callTool<{ ok: boolean; change_id: string }>('propose_change', {
      survey: 'personas2',
      config: baseConfig(),
      base_updated_at: created.structured.draft_updated_at,
      summary: 'בניית השאלון על גבי טיוטת השלד',
    });
    expect(proposal.isError).toBe(false);
    expect(proposal.structured.ok).toBe(true);

    const applied = await callTool<{ applied: boolean }>('apply_change', {
      change_id: proposal.structured.change_id,
    });
    expect(applied.structured.applied).toBe(true);

    // Creation is a write, and it is in the audit log with no revision before it
    const audit = await callTool<{ entries: { survey_id: string; revision_before: string | null }[] }>(
      'get_audit_log',
      { survey: 'personas2' },
    );
    const creation = audit.structured.entries.at(-1);
    expect(creation).toMatchObject({ survey_id: 'personas2', revision_before: null });
    expect(api.names.get('personas2')).toBe('שאלון שתי פרסונות');
  });

  it('refuses a slug that already exists instead of overwriting its draft', async () => {
    harness = await connectHarness();
    const { api, callTool } = harness;
    api.seedDraft('demo', baseConfig());
    const before = api.drafts.get('demo');

    const clash = await callTool('create_survey', { survey: 'demo', name: 'שאלון אחר' });
    expect(clash.isError).toBe(true);
    expect(clash.text).toContain('כבר קיים שאלון עם המזהה');
    // The instruction the model needs: do not retry, pick another slug
    expect(clash.text).toContain('אל תיצרו אותו שוב');
    expect(api.drafts.get('demo')).toEqual(before);
  });

  it('rejects a malformed slug and an empty name at the tool boundary', async () => {
    harness = await connectHarness();
    const { api, callTool } = harness;

    const badSlug = await callTool('create_survey', { survey: 'Not A Slug', name: 'שאלון' });
    expect(badSlug.isError).toBe(true);
    expect(badSlug.text).toContain('survey slug: lowercase letters, digits and hyphens');

    const blankName = await callTool('create_survey', { survey: 'ok-slug', name: '   ' });
    expect(blankName.isError).toBe(true);

    // Neither reached the API: the schema stopped them before any row was written
    expect(api.writesExecuted).toBe(0);
    expect(api.drafts.size).toBe(0);
  });
});
