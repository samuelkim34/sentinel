import { spawn, spawnSync } from 'node:child_process';
import { assertNodeVersion, loadRuntimeEnv, runtimePort } from './runtime.mjs';

assertNodeVersion();
loadRuntimeEnv();
const migrated = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], { stdio: 'inherit' });
if (migrated.status !== 0) process.exit(migrated.status ?? 1);
const children = [spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--port', runtimePort(), '--hostname', process.env.SENTINEL_HOST ?? '0.0.0.0'], { stdio: 'inherit' })];
if (!process.argv.includes('--web-only')) {
  children.push(spawn(process.execPath, ['--import', 'tsx', 'src/worker/main.ts'], { stdio: 'inherit' }));
  children.push(spawn(process.execPath, ['--import', 'tsx', 'src/worker/agents.ts'], { stdio: 'inherit' }));
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true; process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', code => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
