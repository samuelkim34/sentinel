import { spawn, spawnSync } from 'node:child_process';
import { assertNodeVersion, loadRuntimeEnv, runtimePort } from './runtime.mjs';
import { ensureLocalConfig, safeStartupMessage } from './local-config.mjs';

assertNodeVersion();
ensureLocalConfig();
loadRuntimeEnv();
const migrated = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], { stdio: 'inherit' });
if (migrated.error) console.error(safeStartupMessage(migrated.error));
if (migrated.status !== 0) process.exit(migrated.status ?? 1);
const children = [
  spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', runtimePort(), '--hostname', process.env.SENTINEL_HOST ?? '127.0.0.1'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--import', 'tsx', 'src/worker/main.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--import', 'tsx', 'src/worker/agents.ts'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
for (const child of children) {
  child.on('error', error => { console.error(safeStartupMessage(error)); stop(1); });
  child.on('exit', (code) => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
