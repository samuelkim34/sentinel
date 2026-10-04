import { closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { BankOperationError } from "./types";

// Shared by the CLI and web server. Never expire a lock while a writer may
// still be running. An interrupted process requires operator inspection.
export async function withMerchantSetupLock<T>(
  config: { baseUrl: string; apiKey: string; dbPath: string },
  action: () => Promise<T>,
): Promise<T> {
  const base = new URL(config.baseUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new BankOperationError("UNAVAILABLE", "Merchant setup requires an HTTPS Nessie server origin.");
  }
  const directory = dirname(resolve(config.dbPath));
  const fingerprint = createHash("sha256").update(base.origin + "\0" + config.apiKey).digest("hex").slice(0, 16);
  const path = join(directory, `.merchant-setup-${fingerprint}.lock`);
  mkdirSync(directory, { recursive: true });
  let lock: number;
  try { lock = openSync(path, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new BankOperationError("UNAVAILABLE", "Merchant setup is already running or was interrupted. Wait for the current setup; if it was interrupted, ask the server operator to inspect the setup lock and Nessie catalog.");
    }
    throw error;
  }
  try { return await action(); }
  finally { closeSync(lock); rmSync(path); }
}
