// Zod boundary schemas for tool arguments. Every argument is untrusted input:
// the model composes it, and the model gets things wrong. The shapes here
// check the load-bearing structure (screens are objects with string ids, draws
// are lists of scalars…) and deliberately stop there — the semantic truth
// (graph integrity, references, quotas) belongs to validateConfig, which runs
// on every propose AND server-side on every write, so the two layers can
// never drift apart.
//
// ⚠ Every nested object schema is .passthrough(). zod's default strip mode
// would silently delete unknown keys — and a config must round-trip through
// propose/apply byte-identical, unknown fields included.

import { z } from 'zod';
import { SURVEY_SLUG_RE } from '../../../src/data/surveys';

export const slugSchema = z
  .string()
  .regex(SURVEY_SLUG_RE, 'survey slug: lowercase letters, digits and hyphens');

const screenSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(['info', 'consent', 'single', 'multi', 'matrix', 'number', 'text', 'end']),
  })
  .passthrough();

const varMetaSchema = z
  .object({
    label: z.string(),
    values: z.record(z.string()).optional(),
    quotas: z.record(z.number()).optional(),
  })
  .passthrough();

export const configSchema = z
  .object({
    version: z.string().optional(),
    screens: z.array(screenSchema),
    randomVars: z.record(z.array(z.union([z.string(), z.number()]))).optional(),
    varMeta: z.record(varMetaSchema).optional(),
  })
  .passthrough();

/** 80 chars to match MAX_NAME_CHARS in admin-surveys.mts, which silently truncates past it. */
export const surveyNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .describe('The survey name shown in the console — Hebrew, taken from the user');

export const summarySchema = z
  .string()
  .min(1)
  .max(500)
  .describe('A short Hebrew summary of the change, recorded in the audit log');

export const seedVarsSchema = z.record(z.union([z.string(), z.number(), z.boolean()]));

export const quotaCellsSchema = z.array(
  z.object({
    mark: z.string().min(1),
    value: z.string().min(1),
  }),
);
