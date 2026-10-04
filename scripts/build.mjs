import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNodeVersion } from './runtime.mjs';

assertNodeVersion();
// Build inspection must not require deployment secrets or mutate a user's DB.
const buildDirectory = mkdtempSync(join(tmpdir(), 'sentinel-build-'));
const env = {
  ...process.env,
  APP_ORIGIN: 'http://127.0.0.1:43117',
  BETTER_AUTH_URL: 'http://127.0.0.1:43117',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  SENTINEL_DB_PATH: join(buildDirectory, 'build.sqlite'),
  ALLOWED_ORIGINS: '',
  NESSIE_API_KEY: '',
  XAI_API_KEY: '',
  NEXT_TELEMETRY_DISABLED: '1',
};
const migrated = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], { stdio: 'inherit', env });
if (migrated.status !== 0) { rmSync(buildDirectory, { recursive: true, force: true }); process.exit(migrated.status ?? 1); }
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build'], { stdio: 'inherit', env });
const cleanup = () => rmSync(buildDirectory, { recursive: true, force: true });
child.on('error', (error) => { cleanup(); console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { cleanup(); process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
