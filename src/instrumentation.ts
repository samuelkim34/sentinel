export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadEnvFiles } = await import("./server/load-env");
  loadEnvFiles();
  const { getMigrations } = await import("better-auth/db/migration");
  const { authOptions } = await import("./server/auth/config");
  const plan = await getMigrations(authOptions);
  await plan.runMigrations();
}
