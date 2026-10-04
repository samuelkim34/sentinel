import { loadEnvFiles } from "../src/server/load-env";

loadEnvFiles();

const workspaceId = process.argv[2];
const customerId = process.argv[3];
if (!workspaceId || !customerId) {
  console.error("Usage: npm run banking:grant-link -- <workspaceId> <nessieCustomerId>");
  process.exit(1);
}

async function main() {
  const { grantLinkPermission } = await import("../src/domain/accounts");
  const { getDb } = await import("../src/storage/db");
  const result = grantLinkPermission(getDb(), workspaceId, customerId, Date.now());
  console.log(JSON.stringify({ workspaceId, customerId, permissionId: result.id, created: result.created }));
}

void main();
