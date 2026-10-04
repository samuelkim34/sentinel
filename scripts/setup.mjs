import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { assertNodeVersion, runtimePort } from './runtime.mjs';

assertNodeVersion();

mkdirSync("data", { recursive: true });
if (!existsSync(".env.local")) {
  const secret = randomBytes(32).toString("hex");
  writeFileSync(
    ".env.local",
    [
      `APP_ORIGIN=http://127.0.0.1:${runtimePort()}`,
      `BETTER_AUTH_SECRET=${secret}`,
      `BETTER_AUTH_URL=http://127.0.0.1:${runtimePort()}`,
      'ALLOWED_ORIGINS=',
      'ENABLE_MCP_DCR=false',
      'NESSIE_API_KEY=',
      'XAI_API_KEY=',
      "SENTINEL_DB_PATH=data/sentinel.sqlite",
      "NESSIE_BASE_URL=https://api.nessieisreal.com",
      "XAI_VOICE_MODEL=grok-voice-latest",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log("Wrote .env.local. The auth secret was generated and was not printed.");
} else {
  console.log(".env.local already exists.");
}

const migrated = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], { stdio: 'inherit' });
process.exit(migrated.status ?? 1);
