import { spawnSync } from "node:child_process";
import { assertNodeVersion, loadRuntimeEnv } from "./runtime.mjs";
import { ensureLocalConfig, safeStartupMessage } from "./local-config.mjs";

try {
  assertNodeVersion();
  ensureLocalConfig();
  loadRuntimeEnv();
  console.log("Local configuration is ready. Existing keys, settings and data were preserved.");
  const migrated = spawnSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { stdio: "inherit" });
  if (migrated.error) throw migrated.error;
  process.exitCode = migrated.status ?? 1;
} catch (error) {
  console.error(safeStartupMessage(error));
  process.exitCode = 1;
}
