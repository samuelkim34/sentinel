import { withMerchantSetupLock } from "../src/banking/merchant-setup-lock";
import { loadEnvFiles } from "../src/server/load-env";
import { NessieClient } from "../src/banking/nessie-client";
import { BankOperationError } from "../src/banking/types";
import { populateMerchantCatalog, US_MERCHANT_CATALOG } from "../src/banking/sandbox-merchant-catalog";

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--dry-run", "--help"].includes(arg))) throw new Error("Usage: npm run banking:populate-merchants -- [--dry-run]");
  if (args.includes("--help")) {
    console.log("Usage: npm run banking:populate-merchants -- [--dry-run]\nRenames Sentinel Office Supplies to Staples and adds 50 U.S. business names in your Nessie sandbox. Existing names are kept. --dry-run lists changes without writing them.");
    return;
  }
  loadEnvFiles();
  const key = process.env.NESSIE_API_KEY?.trim();
  if (!key) throw new Error("Add NESSIE_API_KEY to .env.local before running this command.");
  const baseUrl = new URL(process.env.NESSIE_BASE_URL || "https://api.nessieisreal.com");
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== "/") {
    throw new Error("Use an HTTPS NESSIE_BASE_URL containing only the server origin.");
  }
  const dryRun = args.includes("--dry-run");
  const populate = async () => {
    console.log(`${dryRun ? "Preview" : "Populate"}: ${US_MERCHANT_CATALOG.length} business names on ${baseUrl.origin}`);
    console.log("Sandbox records only. New records use a shared placeholder address, not actual branch locations.");
    const client = new NessieClient({ baseUrl: baseUrl.origin, apiKey: key });
    const result = await populateMerchantCatalog(client, {
      dryRun,
      onProgress: (action, merchant) => console.log(`${dryRun && action.kind !== "keep" ? "Would " : ""}${action.kind === "keep" ? "Keep" : action.kind === "rename" ? "Rename" : "Create"}: ${action.kind === "rename" ? `${action.merchant.label} → ` : ""}${action.entry.name}${merchant ? ` (${merchant.externalId})` : ""}`),
    });
    console.log(`${dryRun ? "Planned" : "Done"}: ${result.created} new, ${result.renamed} renamed, ${result.existing} already present.`);
    console.log(dryRun ? "Run without --dry-run to apply these changes." : "Open Sentinel → Settings → Sync Nessie merchants, then confirm the categories you want your agents to use.");
  };
  if (dryRun) await populate();
  else await withMerchantSetupLock({ baseUrl: baseUrl.origin, apiKey: key, dbPath: process.env.SENTINEL_DB_PATH || "data/sentinel.sqlite" }, populate);
}

void main().catch(error => {
  // Provider errors omit authenticated URLs and raw response bodies.
  const message = error instanceof BankOperationError || error instanceof Error ? error.message : "Merchant setup failed.";
  const key = process.env.NESSIE_API_KEY?.trim();
  console.error(key ? message.replaceAll(key, "[redacted]") : message);
  console.error("Stopped. Earlier successful changes remain in Nessie. Check Sync Nessie merchants before rerunning after a timeout; merchant writes are never automatically retried.");
  process.exitCode = 1;
});
