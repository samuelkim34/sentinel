import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = process.env.SENTINEL_E2E_DIRECTORY ?? mkdtempSync(join(tmpdir(), "sentinel-e2e-"));
process.env.SENTINEL_E2E_DIRECTORY = directory;

export default defineConfig({
  testDir: "e2e",
  testIgnore: ['**/agent-execution.spec.ts', '**/forms.spec.ts', '**/setup.spec.ts'],
  workers: 1,
  globalTeardown: "./e2e/teardown.ts",
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:43119",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/start.mjs",
    env: { APP_ORIGIN: "http://127.0.0.1:43119", BETTER_AUTH_URL: "http://127.0.0.1:43119", BETTER_AUTH_SECRET: "e2e-only-secret-for-an-isolated-test-database", SENTINEL_DB_PATH: join(directory, "e2e.sqlite"), PORT: "43119", ALLOWED_ORIGINS: "http://localhost:43119", NESSIE_API_KEY: "", XAI_API_KEY: "", ENABLE_MCP_DCR: "true", SOURCE_REPOSITORY_URL: "", NEXT_TELEMETRY_DISABLED: "1" },
    url: "http://127.0.0.1:43119",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
