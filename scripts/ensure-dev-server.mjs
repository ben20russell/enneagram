import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const HOST = '127.0.0.1';
const PORT = '3000';
const LOCK_PATH = '.next/dev/lock';

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' });
}

function isRunning(pid) {
  const check = run('kill', ['-0', String(pid)]);
  return check.status === 0;
}

function terminatePid(pid, reason) {
  if (!pid || Number.isNaN(Number(pid))) {
    return;
  }

  if (!isRunning(pid)) {
    console.log(`[predev] PID ${pid} (${reason}) is not running.`);
    return;
  }

  const killResult = run('kill', [String(pid)]);
  if (killResult.status === 0) {
    console.log(`[predev] Stopped PID ${pid} (${reason}).`);
    return;
  }

  console.log(`[predev] Failed to stop PID ${pid} (${reason}): ${killResult.stderr.trim()}`);
}

function killFromLockFile() {
  if (!existsSync(LOCK_PATH)) {
    console.log('[predev] No existing Next.js lock file found.');
    return;
  }

  try {
    const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
    console.log(`[predev] Found lock file for PID ${lock.pid ?? 'unknown'} at ${lock.appUrl ?? 'unknown'}.`);
    terminatePid(lock.pid, 'Next.js lock file');
  } catch (error) {
    console.log(`[predev] Could not parse ${LOCK_PATH}: ${String(error)}`);
  }
}

function killPortListeners() {
  const listeners = run('lsof', ['-tiTCP:' + PORT, '-sTCP:LISTEN']);
  if (listeners.status !== 0 || !listeners.stdout.trim()) {
    console.log(`[predev] Port ${PORT} is free on ${HOST}.`);
    return;
  }

  const pids = [...new Set(listeners.stdout.trim().split('\n').filter(Boolean))];
  for (const pid of pids) {
    terminatePid(pid, `port ${PORT} listener`);
  }
}

console.log(`[predev] Ensuring a clean dev start on http://${HOST}:${PORT} ...`);
killFromLockFile();
killPortListeners();
console.log('[predev] Port cleanup complete.');
