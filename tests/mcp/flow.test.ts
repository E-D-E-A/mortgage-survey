// The full MCP flow over the in-memory transport: list → get → propose →
// apply → simulate → audit, ending in the golden-task assertion — the applied
// draft equals, byte for byte, the fixture an admin would have built by hand.

import { afterEach, describe, expect, it } from 'vitest';
import { connectHarness, type McpHarness } from './helpers';
import { baseConfig, goldenConfig } from './fixtures';
import type { ConfigDiff } from '../../tools/mcp-server/src/diff';

describe('the golden task: add a persona branch, an A/B draw and a quota', () => {
  let harness: McpHarness;

  afterEach(async () => {
    await harness.close();
  });

  it('walks list → get → propose → apply → simulate and lands exactly on the expected config', async () => {
    harness = await connectHarness();
    const { api, callTool } = harness;
    api.seedDraft('demo', baseConfig());

    const list = await callTool<{ surveys: { slug: string; has_draft: boolean }[] }>('list_surveys');
    expect(list.isError).toBe(false);
    expect(list.structured.surveys).toMatchObject([{ slug: 'demo', has_draft: true }]);

    const draft = await callTool<{ updated_at: string; config_included: boolean; outline: string }>(
      'get_draft',
      { survey: 'demo' },
    );
    expect(draft.isError).toBe(false);
    expect(draft.structured.config_included).toBe(true);
    // The outline speaks the console's language — Hebrew screen kinds
    expect(draft.structured.outline).toContain('מסכים (3):');

    const proposal = await callTool<{ ok: boolean; change_id: string; diff: ConfigDiff }>(
      'propose_change',
      {
        survey: 'demo',
        config: goldenConfig(),
        base_updated_at: draft.structured.updated_at,
        summary: 'הוספת פרסונת זוג צעיר, ניסוי מחיר ומכסה',
      },
    );
    expect(proposal.isError).toBe(false);
    expect(proposal.structured.ok).toBe(true);
    expect(proposal.structured.diff.screens_added.map((s) => s.id)).toEqual([
      's_partner_plans',
      's_price',
      'end_quotafull',
    ]);
    expect(proposal.structured.diff.random_vars_added).toEqual(['price']);
    // Nothing was written by the dry run
    expect(api.writesExecuted).toBe(0);

    const applied = await callTool<{ applied: boolean; updated_at: string }>('apply_change', {
      change_id: proposal.structured.change_id,
    });
    expect(applied.isError).toBe(false);
    expect(applied.structured.applied).toBe(true);

    // The golden assertion: deep-equal AND byte-identical to an independently
    // constructed fixture — Hebrew, quotes and newlines included.
    const stored = api.drafts.get('demo')!.config;
    expect(stored).toEqual(goldenConfig());
    expect(JSON.stringify(stored)).toBe(JSON.stringify(goldenConfig()));

    // The young-couple persona walks through its branch…
    const path = await callTool<{ steps: { id: string }[]; outcome: string }>('simulate_path', {
      survey: 'demo',
      answers: { s_status: 'young_couple', s_partner_plans: 'this_year', s_price: 'yes' },
    });
    expect(path.isError).toBe(false);
    expect(path.structured.steps.map((s) => s.id)).toEqual([
      'intro',
      's_status',
      's_partner_plans',
      's_price',
      'end_complete',
    ]);

    // …anyone else skips it…
    const other = await callTool<{ steps: { id: string }[] }>('simulate_path', {
      survey: 'demo',
      answers: { s_status: 'homeowner', s_price: 'no' },
    });
    expect(other.structured.steps.map((s) => s.id)).toEqual([
      'intro',
      's_status',
      's_price',
      'end_complete',
    ]);

    // …and a full quota routes the persona out, with no rule written anywhere.
    const quotaFull = await callTool<{ steps: { id: string; end_variant?: string }[] }>(
      'simulate_path',
      {
        survey: 'demo',
        answers: { s_status: 'young_couple' },
        full_quota_cells: [{ mark: 'persona', value: 'young_couple' }],
      },
    );
    const lastStep = quotaFull.structured.steps.at(-1)!;
    expect(lastStep.id).toBe('end_quotafull');
    expect(lastStep.end_variant).toBe('quotafull');

    const audit = await callTool<{ entries: { summary: string }[] }>('get_audit_log', {
      survey: 'demo',
    });
    expect(audit.structured.entries).toHaveLength(1);
    expect(audit.structured.entries[0].summary).toBe('הוספת פרסונת זוג צעיר, ניסוי מחיר ומכסה');
  });

  it('simulates a pending proposal (change_id) before anything is applied', async () => {
    harness = await connectHarness();
    const { api, callTool } = harness;
    const updatedAt = api.seedDraft('demo', baseConfig());

    const proposal = await callTool<{ change_id: string }>('propose_change', {
      survey: 'demo',
      config: goldenConfig(),
      base_updated_at: updatedAt,
      summary: 'בדיקת סימולציה לפני החלה',
    });
    const path = await callTool<{ steps: { id: string }[] }>('simulate_path', {
      survey: 'demo',
      answers: { s_status: 'young_couple', s_partner_plans: 'later', s_price: 'yes' },
      change_id: proposal.structured.change_id,
    });
    expect(path.structured.steps.map((s) => s.id)).toContain('s_partner_plans');
    // The saved draft is untouched — the simulation ran on the proposal
    expect(api.drafts.get('demo')!.config).toEqual(baseConfig());
  });

  it('creates a first draft when base_updated_at is null', async () => {
    harness = await connectHarness();
    const { api, callTool } = harness;
    api.seedDraft('fresh', null);

    const proposal = await callTool<{ ok: boolean; change_id: string }>('propose_change', {
      survey: 'fresh',
      config: baseConfig(),
      base_updated_at: null,
      summary: 'טיוטה ראשונה',
    });
    expect(proposal.structured.ok).toBe(true);
    const applied = await callTool<{ applied: boolean }>('apply_change', {
      change_id: proposal.structured.change_id,
    });
    expect(applied.structured.applied).toBe(true);
    expect(api.drafts.get('fresh')!.config).toEqual(baseConfig());
  });
});
