import type { MerchantCategory } from "../contracts/constants";
import { BankOperationError, type MerchantRecord } from "./types";
import type { NessieClient, SandboxMerchantInput } from "./nessie-client";

export type CatalogEntry = { name: string; category: Exclude<MerchantCategory, "UNKNOWN"> };

// Requested sandbox businesses. Categories are suggestions, never spending
// permissions; workspace owners still confirm them in Settings after syncing.
export const US_MERCHANT_CATALOG: readonly CatalogEntry[] = [
  { name: "Staples", category: "OFFICE" },
  { name: "Office Depot", category: "OFFICE" },
  { name: "Walmart", category: "OTHER" },
  { name: "Target", category: "OTHER" },
  { name: "Costco", category: "OTHER" },
  { name: "Amazon", category: "OTHER" },
  { name: "Best Buy", category: "OTHER" },
  { name: "Apple", category: "OTHER" },
  { name: "The Home Depot", category: "OTHER" },
  { name: "Lowe's", category: "OTHER" },
  { name: "IKEA", category: "OTHER" },
  { name: "Ace Hardware", category: "OTHER" },
  { name: "Kroger", category: "GROCERIES" },
  { name: "Whole Foods Market", category: "GROCERIES" },
  { name: "Trader Joe's", category: "GROCERIES" },
  { name: "ALDI", category: "GROCERIES" },
  { name: "Publix", category: "GROCERIES" },
  { name: "Safeway", category: "GROCERIES" },
  { name: "Wegmans", category: "GROCERIES" },
  { name: "Starbucks", category: "DINING" },
  { name: "Dunkin'", category: "DINING" },
  { name: "McDonald's", category: "DINING" },
  { name: "Chick-fil-A", category: "DINING" },
  { name: "Chipotle", category: "DINING" },
  { name: "Subway", category: "DINING" },
  { name: "Taco Bell", category: "DINING" },
  { name: "Panera Bread", category: "DINING" },
  { name: "Domino's", category: "DINING" },
  { name: "Wendy's", category: "DINING" },
  { name: "Burger King", category: "DINING" },
  { name: "CVS Pharmacy", category: "HEALTH" },
  { name: "Walgreens", category: "HEALTH" },
  { name: "Shell", category: "TRANSPORT" },
  { name: "Exxon", category: "TRANSPORT" },
  { name: "Chevron", category: "TRANSPORT" },
  { name: "Uber", category: "TRANSPORT" },
  { name: "Lyft", category: "TRANSPORT" },
  { name: "Microsoft", category: "SOFTWARE" },
  { name: "Adobe", category: "SOFTWARE" },
  { name: "Zoom", category: "SOFTWARE" },
  { name: "Dropbox", category: "SOFTWARE" },
  { name: "Intuit", category: "SOFTWARE" },
  { name: "Netflix", category: "ENTERTAINMENT" },
  { name: "Spotify", category: "ENTERTAINMENT" },
  { name: "Airbnb", category: "TRAVEL" },
  { name: "Marriott", category: "TRAVEL" },
  { name: "Hilton", category: "TRAVEL" },
  { name: "Delta Air Lines", category: "TRAVEL" },
  { name: "United Airlines", category: "TRAVEL" },
  { name: "American Airlines", category: "TRAVEL" },
];

export type CatalogAction =
  | { kind: "rename"; entry: CatalogEntry; merchant: MerchantRecord }
  | { kind: "create"; entry: CatalogEntry }
  | { kind: "keep"; entry: CatalogEntry; merchant: MerchantRecord };

function nameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function suggestedMerchantCategory(name: string): CatalogEntry["category"] | null {
  return US_MERCHANT_CATALOG.find(entry => nameKey(entry.name) === nameKey(name))?.category ?? null;
}

export function planMerchantCatalog(existing: readonly MerchantRecord[], catalog = US_MERCHANT_CATALOG): CatalogAction[] {
  const byName = new Map<string, MerchantRecord[]>();
  const seenIds = new Set<string>();
  for (const merchant of existing) {
    if (seenIds.has(merchant.externalId)) continue;
    seenIds.add(merchant.externalId);
    const key = nameKey(merchant.label);
    byName.set(key, [...(byName.get(key) ?? []), merchant]);
  }
  const legacy = byName.get(nameKey("Sentinel Office Supplies")) ?? [];
  const staples = byName.get(nameKey("Staples")) ?? [];
  if (legacy.length > 1) throw new BankOperationError("INVALID_RESPONSE", "Several merchants are named Sentinel Office Supplies. Resolve the duplicate names in Nessie before setup; no changes were made.");
  if (legacy.length && staples.length) throw new BankOperationError("INVALID_RESPONSE", "Both Staples and Sentinel Office Supplies already exist. Resolve that rename conflict in Nessie first; no changes were made.");
  const entries = new Set<string>();
  return catalog.map(entry => {
    const key = nameKey(entry.name);
    if (!key || entries.has(key)) throw new BankOperationError("INVALID_RESPONSE", "The requested catalog contains duplicate or empty business names.");
    entries.add(key);
    const matches = byName.get(key) ?? [];
    if (matches.length > 1) throw new BankOperationError("INVALID_RESPONSE", `Several Nessie merchants match ${entry.name}. Resolve those duplicate names first; no changes were made.`);
    if (matches[0]) return { kind: "keep", entry, merchant: matches[0] };
    if (key === nameKey("Staples") && legacy[0]) return { kind: "rename", entry, merchant: legacy[0] };
    return { kind: "create", entry };
  });
}

function sandboxInput(entry: CatalogEntry): SandboxMerchantInput {
  return {
    name: entry.name,
    category: entry.category,
    // Shared synthetic location for sandbox compatibility. This is not a
    // retailer's actual address, branch, checkout or geolocation listing.
    address: { street_number: "1", street_name: "Sandbox Way", city: "Fairfax", state: "VA", zip: "22030" },
    geocode: { lat: 38.8462, lng: -77.3064 },
  };
}

export async function populateMerchantCatalog(
  client: Pick<NessieClient, "listMerchants" | "createSandboxMerchant" | "renameSandboxMerchant">,
  options: { dryRun?: boolean; onProgress?: (action: CatalogAction, result: MerchantRecord | null) => void; catalog?: readonly CatalogEntry[] } = {},
) {
  // A partial listing cannot establish whether a merchant already exists.
  const existing = await client.listMerchants(1000, { requireComplete: true });
  const plan = planMerchantCatalog(existing, options.catalog);
  const summary = { created: 0, renamed: 0, existing: 0, dryRun: Boolean(options.dryRun) };
  for (const action of plan) {
    let result: MerchantRecord | null = null;
    if (action.kind === "keep") { summary.existing++; result = action.merchant; }
    else if (action.kind === "rename") {
      if (!options.dryRun) result = await client.renameSandboxMerchant(action.merchant.externalId, action.merchant.label, action.entry.name);
      summary.renamed++;
    } else {
      if (!options.dryRun) result = await client.createSandboxMerchant(sandboxInput(action.entry));
      summary.created++;
    }
    options.onProgress?.(action, result);
  }
  return summary;
}
