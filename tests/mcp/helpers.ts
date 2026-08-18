// Harness for the MCP integration tests: a real SDK client talking to the real
// server over the in-memory transport pair — the full protocol handshake and
// tool dispatch, with only the admin API faked (fake-api.ts).

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSurveyMcpServer } from '../../tools/mcp-server/src/server';
import { ProposalStore } from '../../tools/mcp-server/src/proposals';
import { FakeApi } from './fake-api';

export interface McpHarness {
  api: FakeApi;
  client: Client;
  proposals: ProposalStore;
  callTool<T = Record<string, unknown>>(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ isError: boolean; text: string; structured: T }>;
  close(): Promise<void>;
}

export async function connectHarness(now?: () => number): Promise<McpHarness> {
  const api = new FakeApi();
  const proposals = new ProposalStore(now);
  const server = createSurveyMcpServer({ api, proposals });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    api,
    client,
    proposals,
    async callTool<T>(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as { type: string; text?: string }[];
      const text = content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n');
      return {
        isError: result.isError === true,
        text,
        structured: result.structuredContent as T,
      };
    },
    async close() {
      await client.close();
    },
  };
}
