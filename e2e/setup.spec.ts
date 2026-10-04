import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureLocalConfig, readLocalConfig } from "../scripts/local-config.mjs";
import { startSetupWizard } from "../scripts/setup-wizard.mjs";

test("local browser setup saves both keys without disclosing them or requiring terminal edits", async ({ page }) => {
  const directory = mkdtempSync(join(tmpdir(), "sentinel-setup-browser-"));
  const wizard = await startSetupWizard(directory, ensureLocalConfig(directory, {}));
  if (!wizard) throw new Error("Expected a fresh setup wizard.");
  try {
    await page.goto(wizard.url);
    await page.getByLabel("Nessie sandbox API key").fill("fixture-bank-key");
    await page.getByLabel("xAI API key").fill("fixture-xai-key");
    await page.getByRole("button", { name: "Save keys and start Sentinel" }).click();
    await expect(page.locator("body")).toContainText("Keys saved.");
    await wizard.done;
    const config = readLocalConfig(directory, {});
    expect(config.NESSIE_API_KEY).toBe("fixture-bank-key");
    expect(config.XAI_API_KEY).toBe("fixture-xai-key");
    expect(config.NESSIE_SIMULATE_COMPLETION).toBe("true");
    await expect(page.locator("body")).not.toContainText("fixture-bank-key");
  } finally { wizard.close(); rmSync(directory, { recursive: true, force: true }); }
});
