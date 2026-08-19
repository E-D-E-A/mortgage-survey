// Frees the local dev ports, so a process left over from a previous run cannot
// block the next one.
// Usage: npm run free-ports [-- 8888 5199]  — also runs automatically before
// `npm run dev:netlify`.
//
// Why this is needed at all: Windows has no process-group signal. Ctrl+C, a
// closed terminal or a stopped background task ends the process that was
// launched, and every descendant is re-parented and keeps running — including
// the one actually holding the socket. `taskkill /T` walks the tree; killing a
// pid on its own does not.
import { execFileSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
const DEFAULT_PORTS = [8888, 5199]; // netlify dev, and the vite it fronts

const requested = process.argv.slice(2);
const ports = (requested.length ? requested : DEFAULT_PORTS).map((value) => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`not a port: ${value}`);
    process.exit(1);
  }
  return port;
});

function capture(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    // Both tools exit non-zero when they simply have nothing to report.
    return '';
  }
}

function alive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM'; // running, just not ours to signal
  }
}

// pid -> the ports that pid is listening on
function listeners() {
  const found = new Map();
  const add = (pid, port) => {
    if (!pid || pid === '0' || Number(pid) === process.pid) return;
    if (!found.has(pid)) found.set(pid, new Set());
    found.get(pid).add(port);
  };

  if (isWindows) {
    // Proto | Local Address | Foreign Address | State | PID
    for (const line of capture('netstat', ['-ano', '-p', 'TCP']).split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || columns[3] !== 'LISTENING') continue;
      const local = columns[1];
      const port = Number(local.slice(local.lastIndexOf(':') + 1));
      if (ports.includes(port)) add(columns[4], port);
    }
  } else {
    for (const port of ports) {
      const out = capture('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
      for (const pid of out.split(/\s+/).filter(Boolean)) add(pid, port);
    }
  }
  return found;
}

const holders = listeners();
if (holders.size === 0) {
  console.log(`free: ${ports.join(', ')}`);
}

for (const [pid, held] of holders) {
  const label = [...held].sort((a, b) => a - b).join(', ');
  // A tree kill may already have taken this pid down as somebody's descendant.
  if (!alive(pid)) {
    console.log(`freed ${label} — pid ${pid} already gone`);
    continue;
  }
  try {
    if (isWindows) execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
    else process.kill(Number(pid), 'SIGKILL');
    console.log(`freed ${label} — killed pid ${pid}`);
  } catch (error) {
    console.error(`could not kill pid ${pid} holding ${label}: ${error.message}`);
    process.exitCode = 1;
  }
}
