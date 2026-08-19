// Every edge case the MCP layer promises to handle, driven through the real
// server and the real SDK client. The fake API injects the failures a live
// server would produce; the assertions are about what the MODEL is told —
// because the tool text is the only steering wheel the flow has.

import { afterEach, describe, expect, it } from 'vitest';
import { validateConfig } from '../../src/engine/validate';
import type { SurveyConfig } from '../../src/engine/types';
import { connectHarness, type McpHarness } from './helpers';
import { baseConfig, goldenConfig } from './fixtures';

let harness: McpHarness;

afterEach(async () => {
  await harness?.close();
});

async function proposed(summary = 'שינוי לבדיקה'): Promise<{ changeId: string }> {
  const updatedAt = harness.api.seedDraft('demo', baseConfig());
  const res = await harness.callTool<{ change_id: string }>('propose_change', {
    survey: 'demo',
    config: goldenConfig(),
    base_updated_at: updatedAt,
    summary,
  });
  expect(res.isError).toBe(false);
  return { changeId: res.structured.change_id };
}

describe('concurrent edits', () => {
  it('a console save between propose and apply → 409 with clear re-fetch guidance, nothing merged', async () => {
    harness = await connectHarness();
    const { changeId } = await proposed();

    // Someone saves in /admin in the meantime
    harness.api.seedDraft('demo', baseConfig());

    const applied = await harness.callTool('apply_change', { change_id: changeId });
    expect(applied.isError).toBe(true);
    expect(applied.text).toContain('get_draft');
    expect(applied.text).toContain('אל תמזגו');
    // The stale proposal must not have overwritten the concurrent save
    expect(harness.api.writesExecuted).toBe(0);
    expect(harness.api.drafts.get('demo')!.config).toEqual(baseConfig());
  });

  it('a stale base_updated_at is caught already at propose time', async () => {
    harness = await connectHarness();
    harness.api.seedDraft('demo', baseConfig());
    const res = await harness.callTool('propose_change', {
      survey: 'demo',
      config: goldenConfig(),
      base_updated_at: '2020-01-01T00:00:00.000Z',
      summary: 'בסיס ישן',
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Stale base revision');
    expect(res.text).toContain('get_draft');
  });
});

describe('the analysis-code lock', () => {
  it('renaming a locked mark on a published survey is rejected, naming the codes', async () => {
    harness = await connectHarness();
    harness.api.seedPublished('demo', goldenConfig());
    const updatedAt = harness.api.seedDraft('demo', goldenConfig());

    // "Rename" persona → segment: every rule now assigns the new name
    const renamed = goldenConfig();
    for (const screen of renamed.screens) {
      for (const rule of screen.onSubmit ?? []) if (rule.var === 'persona') rule.var = 'segment';
      if (screen.showIf && 'var' in screen.showIf && screen.showIf.var === 'persona') {
        screen.showIf = { var: 'segment', op: 'eq', value: 'young_couple' };
      }
    }
    renamed.varMeta = { price: { label: 'מחיר לניסוי' }, segment: renamed.varMeta!.persona };

    const res = await harness.callTool<{ ok: boolean; code_lock: { name: string }[] }>(
      'propose_change',
      { survey: 'demo', config: renamed, base_updated_at: updatedAt, summary: 'שינוי שם סימון' },
    );
    expect(res.isError).toBe(true);
    expect(res.structured.ok).toBe(false);
    expect(res.structured.code_lock.map((v) => v.name)).toContain('persona');
    // The explanation the human gets: locked since first publish
    expect(res.text).toContain('פורסם');
    expect(harness.api.writesExecuted).toBe(0);
  });

  it('the server-side gate catches a client that skipped the dry run', async () => {
    harness = await connectHarness();
    harness.api.seedPublished('demo', goldenConfig());
    const updatedAt = harness.api.seedDraft('demo', goldenConfig());
    const withoutDraw = goldenConfig();
    delete withoutDraw.randomVars;
    delete withoutDraw.varMeta!.price;
    // Remove the interpolation so the config is otherwise valid
    withoutDraw.screens = withoutDraw.screens.map((s) =>
      s.id === 's_price' && s.type === 'single'
        ? { ...s, prompt: 'האם הייתם משלמים על ליווי מקצועי?' }
        : s,
    );
    const res = await harness.api.putDraft('demo', {
      config: withoutDraw,
      expected_updated_at: updatedAt,
      idempotency_key: 'direct-1',
      summary: 'עקיפת הדריי-ראן',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
      expect((res.body.locked ?? []).map((v) => v.name)).toContain('price');
    }
  });
});

describe('invalid configs', () => {
  it('unknown refs come back as validateConfig errors verbatim, with the valid ids for self-correction', async () => {
    harness = await connectHarness();
    const updatedAt = harness.api.seedDraft('demo', baseConfig());
    const broken = baseConfig();
    broken.screens[1].next = [{ if: { q: 'no_such_screen', op: 'eq', value: 'x' }, goto: 'nowhere' }];

    const res = await harness.callTool<{
      ok: boolean;
      errors: { message: string }[];
      valid_screen_ids: string[];
    }>('propose_change', {
      survey: 'demo',
      config: broken,
      base_updated_at: updatedAt,
      summary: 'הפניות שבורות',
    });
    expect(res.isError).toBe(true);
    const expected = validateConfig(broken).filter((i) => i.level === 'error');
    expect(res.structured.errors).toEqual(expected);
    expect(res.structured.valid_screen_ids).toEqual(['intro', 's_status', 'end_complete']);
    for (const issue of expected) expect(res.text).toContain(issue.message);
  });

  it('a quota without a quotafull end screen surfaces the validateConfig issue verbatim', async () => {
    harness = await connectHarness();
    const updatedAt = harness.api.seedDraft('demo', baseConfig());
    const config = goldenConfig();
    config.screens = config.screens.filter((s) => s.id !== 'end_quotafull');

    const res = await harness.callTool<{ errors: { code: string; message: string }[] }>(
      'propose_change',
      { survey: 'demo', config, base_updated_at: updatedAt, summary: 'מכסה בלי מסך' },
    );
    expect(res.isError).toBe(true);
    const quotaIssue = validateConfig(config).find((i) => i.code === 'quota')!;
    expect(res.structured.errors).toContainEqual(quotaIssue);
    expect(res.text).toContain(quotaIssue.message);
  });

  it('a structurally malformed config is stopped at the MCP boundary', async () => {
    harness = await connectHarness();
    harness.api.seedDraft('demo', baseConfig());
    // screens as a string — the zod boundary must refuse before any logic runs
    const attempt = harness.client.callTool({
      name: 'propose_change',
      arguments: {
        survey: 'demo',
        config: { screens: 'not-an-array' },
        base_updated_at: null,
        summary: 'שבור',
      },
    });
    await expect(
      attempt.then((r) => {
        expect(r.isError).toBe(true);
        return r;
      }),
    ).resolves.toBeDefined();
  });
});

describe('retries and idempotency', () => {
  it('a network failure after the write executed → retry with the same change_id applies once', async () => {
    harness = await connectHarness();
    const { changeId } = await proposed();
    harness.api.failNext = 'network-after-write';

    const first = await harness.callTool('apply_change', { change_id: changeId });
    expect(first.isError).toBe(true);
    expect(first.text).toContain('change_id');
    expect(harness.api.writesExecuted).toBe(1);

    const retry = await harness.callTool<{ applied: boolean; updated_at: string }>('apply_change', {
      change_id: changeId,
    });
    expect(retry.isError).toBe(false);
    expect(retry.structured.applied).toBe(true);
    // The idempotency key replayed the stored result — no second execution
    expect(harness.api.writesExecuted).toBe(1);
    expect(harness.api.audit).toHaveLength(1);
  });

  it('an applied change_id cannot be applied twice', async () => {
    harness = await connectHarness();
    const { changeId } = await proposed();
    const first = await harness.callTool('apply_change', { change_id: changeId });
    expect(first.isError).toBe(false);

    const again = await harness.callTool('apply_change', { change_id: changeId });
    expect(again.isError).toBe(true);
    expect(again.text).toContain('propose_change');
    expect(harness.api.writesExecuted).toBe(1);
  });

  it('an expired change_id demands a fresh propose', async () => {
    let now = 1_000_000_000;
    harness = await connectHarness(() => now);
    const { changeId } = await proposed();

    now += 16 * 60_000;

    const res = await harness.callTool('apply_change', { change_id: changeId });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('propose_change');
    expect(harness.api.writesExecuted).toBe(0);
  });
});

describe('rate limits and auth', () => {
  it('a 429 tells the model how long to wait and to stop retrying', async () => {
    harness = await connectHarness();
    const { changeId } = await proposed();
    harness.api.failNext = { status: 429, body: { error: 'rate-limit', retry_after_seconds: 1234 } };

    const res = await harness.callTool('apply_change', { change_id: changeId });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('1234');
    expect(res.text).toContain('STOP');

    // The proposal survived — after the window it can be retried as-is
    const retry = await harness.callTool<{ applied: boolean }>('apply_change', {
      change_id: changeId,
    });
    expect(retry.structured.applied).toBe(true);
  });

  it('an expired/revoked token yields a structured re-login instruction, never a fallback credential', async () => {
    harness = await connectHarness();
    harness.api.failNext = { status: 401, body: { error: 'unauthorized' } };
    const res = await harness.callTool('get_draft', { survey: 'demo' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('first-edea.com');
    expect(res.text).toContain('התחברות מחדש');
  });

  it('a foreign-domain account is told the account itself is not allowed', async () => {
    harness = await connectHarness();
    harness.api.failNext = { status: 403, body: { error: 'forbidden' } };
    const res = await harness.callTool('list_surveys');
    expect(res.isError).toBe(true);
    expect(res.text).toContain('first-edea.com');
  });
});

describe('large configs and round-trips', () => {
  it('a huge draft returns the outline plus a way to fetch the full JSON — no silent truncation', async () => {
    harness = await connectHarness();
    const big = baseConfig();
    (big.screens[0] as { body: string }).body = 'ש'.repeat(70_000);
    harness.api.seedDraft('demo', big);

    const outlineOnly = await harness.callTool<{ config_included: boolean; config?: unknown }>(
      'get_draft',
      { survey: 'demo' },
    );
    expect(outlineOnly.structured.config_included).toBe(false);
    expect(outlineOnly.structured.config).toBeUndefined();
    expect(outlineOnly.text).toContain('full_config');

    const full = await harness.callTool<{ config_included: boolean; config: SurveyConfig }>(
      'get_draft',
      { survey: 'demo', full_config: true },
    );
    expect(full.structured.config_included).toBe(true);
    expect(JSON.stringify(full.structured.config)).toBe(JSON.stringify(big));
  });

  it('an oversized proposal is refused locally, before it can fill the store', async () => {
    harness = await connectHarness();
    const updatedAt = harness.api.seedDraft('demo', baseConfig());
    const huge = baseConfig();
    (huge.screens[0] as { body: string }).body = 'ש'.repeat(600_000);
    const res = await harness.callTool('propose_change', {
      survey: 'demo',
      config: huge,
      base_updated_at: updatedAt,
      summary: 'גדול מדי',
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('500KB');
  });

  it('the server 413 (500KB cap) surfaces clearly', async () => {
    harness = await connectHarness();
    const { changeId } = await proposed();
    harness.api.failNext = { status: 413, body: { error: 'config-too-large', max_bytes: 500_000 } };
    const res = await harness.callTool('apply_change', { change_id: changeId });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('500KB');
  });

  it('Hebrew content — quotes, newlines, gershayim — round-trips byte-identical', async () => {
    harness = await connectHarness();
    const config = baseConfig();
    (config.screens[0] as { body: string }).body =
      'שורה ראשונה\nשורה עם "מרכאות" וגם ״גרשיים״ ו־מקף\nושורה שלישית';
    const updatedAt = harness.api.seedDraft('demo', baseConfig());

    const proposal = await harness.callTool<{ change_id: string }>('propose_change', {
      survey: 'demo',
      config,
      base_updated_at: updatedAt,
      summary: 'נוסח עם מרכאות ושורות',
    });
    await harness.callTool('apply_change', { change_id: proposal.structured.change_id });
    expect(JSON.stringify(harness.api.drafts.get('demo')!.config)).toBe(JSON.stringify(config));

    const back = await harness.callTool<{ config: SurveyConfig }>('get_draft', { survey: 'demo' });
    expect(JSON.stringify(back.structured.config)).toBe(JSON.stringify(config));
  });
});
