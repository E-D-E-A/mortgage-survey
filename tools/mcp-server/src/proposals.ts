// The pending-proposal store behind propose_change / apply_change.
//
// In-process state is a deliberate choice for a single-user stdio server: the
// guarantee it provides is UX-level — "what the human confirmed is what gets
// applied, byte for byte" (the hash check below) — while every security
// guarantee (auth, validation, code lock, optimistic lock, idempotency, rate
// limit) lives server-side in the Netlify functions and holds regardless of
// what this process does or claims.

import { createHash, randomUUID } from 'node:crypto';
import type { SurveyConfig } from '../../../src/engine/types';

const PROPOSAL_TTL_MS = 15 * 60_000;

export interface Proposal {
  survey: string;
  config: SurveyConfig;
  hash: string;
  baseUpdatedAt: string | null;
  summary: string;
  createdAt: number;
}

export const hashConfig = (config: unknown): string =>
  createHash('sha256').update(JSON.stringify(config), 'utf8').digest('hex');

export class ProposalStore {
  private readonly byId = new Map<string, Proposal>();

  constructor(private readonly now: () => number = Date.now) {}

  private prune(): void {
    const cutoff = this.now() - PROPOSAL_TTL_MS;
    for (const [id, p] of this.byId) {
      if (p.createdAt < cutoff) this.byId.delete(id);
    }
  }

  put(proposal: Omit<Proposal, 'hash' | 'createdAt'>): string {
    this.prune();
    const id = randomUUID();
    this.byId.set(id, {
      ...proposal,
      hash: hashConfig(proposal.config),
      createdAt: this.now(),
    });
    return id;
  }

  /**
   * The proposal for an id, hash-verified — a byte-for-byte match between what
   * was proposed (and confirmed by the human) and what will be sent. null =
   * unknown, expired, or already consumed; the caller demands a fresh propose.
   */
  take(id: string): Proposal | null {
    this.prune();
    const proposal = this.byId.get(id);
    if (!proposal) return null;
    if (hashConfig(proposal.config) !== proposal.hash) {
      // Cannot happen without a bug or in-process tampering — refuse loudly
      this.byId.delete(id);
      return null;
    }
    return proposal;
  }

  /** Called after a definitive server answer — success or a rejection that demands re-proposing. */
  consume(id: string): void {
    this.byId.delete(id);
  }
}
