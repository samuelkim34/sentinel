import { loadEnvFiles } from "../src/server/load-env";
import { safeStartupMessage } from "./local-config.mjs";

loadEnvFiles();

async function main() {
  const { getMigrations } = await import("better-auth/db/migration");
  const { authOptions } = await import("../src/server/auth/config");
  const plan = await getMigrations(authOptions);
  await plan.runMigrations();
  console.log("Auth tables and the Sentinel application schema are ready.");
}

main().catch((error: unknown) => {
  console.error(`Migration failed: ${safeStartupMessage(error)}`);
  process.exit(1);
});
