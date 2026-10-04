import { spawn, spawnSync } from 'node:child_process';
import { assertNodeVersion, loadRuntimeEnv, runtimePort } from './runtime.mjs';

assertNodeVersion();
loadRuntimeEnv();
const migrated = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], { stdio: 'inherit' });
if (migrated.status !== 0) process.exit(migrated.status ?? 1);
const web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--port', runtimePort(), '--hostname', process.env.SENTINEL_HOST ?? '0.0.0.0'], { stdio: 'inherit' });
web.on('error', () => { process.exitCode = 1; });
web.on('exit', (code) => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => web.kill('SIGINT'));
process.on('SIGTERM', () => web.kill('SIGTERM'));
