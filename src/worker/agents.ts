import { loadEnvFiles } from '../server/load-env';
loadEnvFiles();
let stopping = false;
const controller = new AbortController();
const stop = () => { stopping = true; controller.abort(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

async function main() {
  const { getDb, closeDb } = await import('../storage/db');
  const { runAgentCycle, agentHeartbeat } = await import('../agents/runner');
  const db = getDb();
  const heartbeat = setInterval(() => { try { agentHeartbeat(db); } catch {} }, 5000);
  try {
    while (!stopping) {
      try { await runAgentCycle(db, undefined, controller.signal); }
      catch (error) { console.error(JSON.stringify({ agentWorker: 'cycle_failed', name: error instanceof Error ? error.name : 'Error' })); }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally { clearInterval(heartbeat); closeDb(); }
}
void main();
