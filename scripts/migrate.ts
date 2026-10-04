import { loadEnvFiles } from "../src/server/load-env";

loadEnvFiles();

async function main() {
  const { getMigrations } = await import("better-auth/db/migration");
  const { authOptions } = await import("../src/server/auth/config");
  const plan = await getMigrations(authOptions);
  await plan.runMigrations();
  console.log("Auth tables and the Sentinel application schema are ready.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "migration failed");
  process.exit(1);
});
