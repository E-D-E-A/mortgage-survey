// Entry point: stdio transport, run locally by each teammate from their Claude
// client config (see SETUP.md). stdout is the protocol channel — every log
// line goes to stderr, without exception.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AuthManager } from './auth';
import { HttpApiClient } from './api';
import { createSurveyMcpServer } from './server';

const log = (line: string): void => {
  console.error(`[mortgage-survey-mcp] ${line}`);
};

// The local dev stack's well-known demo values (identical in every `supabase
// start` installation, not a secret) — so a developer can run the whole flow
// against `netlify dev` with zero configuration. Production values come from
// the Claude client config's env block; both keys here are public by design
// (the anon key also ships in the console's browser bundle).
const DEFAULTS = {
  apiUrl: 'http://localhost:8888',
  supabaseUrl: 'http://127.0.0.1:54321',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
  loginPort: 43117,
};

const apiUrl = (process.env.SURVEY_API_URL ?? DEFAULTS.apiUrl).replace(/\/+$/, '');
const supabaseUrl = process.env.SURVEY_SUPABASE_URL ?? DEFAULTS.supabaseUrl;
const anonKey = process.env.SURVEY_SUPABASE_ANON_KEY ?? DEFAULTS.anonKey;
const loginPort = Number(process.env.SURVEY_MCP_LOGIN_PORT ?? DEFAULTS.loginPort);
const authFile =
  process.env.SURVEY_MCP_AUTH_FILE ?? join(homedir(), '.mortgage-survey-mcp', 'auth.json');

const auth = new AuthManager({ supabaseUrl, anonKey, loginPort, authFile, log });
const api = new HttpApiClient(apiUrl, () => auth.token());
const server = createSurveyMcpServer({ api });

const transport = new StdioServerTransport();
await server.connect(transport);
log(`running on stdio · api=${apiUrl} · supabase=${supabaseUrl}`);
