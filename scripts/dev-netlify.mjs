// Starts `netlify dev` with node directly, instead of through npx.
// Usage: npm run dev:netlify [-- --skip-wait-port]
//
// `npx netlify dev` builds a five-deep process tree:
//   bash -> bash -> node(npx) -> cmd -> node(netlify)
// Windows has no process-group signal, so Ctrl+C reaches only the top of that
// tree and the netlify process at the bottom survives, still holding 8888. The
// next run then fails with "Could not acquire required 'port': '8888'", while
// the browser keeps answering from the stale server and the app looks broken.
// Spawning netlify's entry point with node removes the npx and cmd layers, so
// the process we start is the process that listens — and stopping it stops it.
// Same reasoning that made netlify.toml run vite through node rather than npx.
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const nodeDir = dirname(process.execPath);

// netlify-cli is normally a global install; look where each platform keeps one.
const candidates = [
  join(repoRoot, 'node_modules', 'netlify-cli', 'bin', 'run.js'),
  join(nodeDir, 'node_modules', 'netlify-cli', 'bin', 'run.js'),
  join(dirname(nodeDir), 'lib', 'node_modules', 'netlify-cli', 'bin', 'run.js'),
];

const entry = candidates.find((path) => existsSync(path));
if (!entry) {
  console.error('netlify-cli not found — install it with: npm i -g netlify-cli');
  console.error('looked in:');
  for (const path of candidates) console.error(`  ${path}`);
  process.exit(1);
}

const child = spawn(process.execPath, [entry, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: repoRoot,
});

child.on('error', (error) => {
  console.error(`could not start netlify: ${error.message}`);
  process.exit(1);
});

// Pass the signal down and let netlify close its own children before we go.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (child.exitCode === null && !child.killed) child.kill(signal);
  });
}

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : code ?? 0);
});
