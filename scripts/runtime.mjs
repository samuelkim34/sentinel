import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export function assertNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 15) throw new Error(`Node 24.15+ in the 24 line is required; found ${process.versions.node}.`);
}

export function loadRuntimeEnv() {
  for (const path of ['.env.local', '.env']) {
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function runtimePort() {
  const port = Number(process.env.PORT ?? 43117);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  return String(port);
}
