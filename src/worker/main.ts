import { loadEnvFiles } from "../server/load-env";

loadEnvFiles();

const stop = { value: false };
process.on("SIGTERM", () => { stop.value = true; });
process.on("SIGINT", () => { stop.value = true; });

async function main() {
  const { getDb, closeDb } = await import("../storage/db");
  const { runWorkerCycle } = await import("../domain/settlement");
  const db = getDb();
  const poll = Number(process.env.WORKER_POLL_MS ?? 1000);
  while (!stop.value) {
    try {
      await runWorkerCycle(db);
    } catch (error) {
      console.error(JSON.stringify({ worker: "cycle_failed", name: error instanceof Error ? error.name : "Error" }));
    }
    await new Promise((resolve) => setTimeout(resolve, poll));
  }
  closeDb();
}

void main();
