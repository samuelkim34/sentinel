import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ensureLocalConfig, readLocalConfig, safeStartupMessage } from "../scripts/local-config.mjs";
import { startSetupWizard } from "../scripts/setup-wizard.mjs";

it("fresh setup generates private stable configuration with sandbox defaults and no demo data", () => {
  const directory = mkdtempSync(join(tmpdir(), "sentinel-setup-"));
  try {
    const first = ensureLocalConfig(directory, {});
    assert.equal(first.APP_ORIGIN, "http://127.0.0.1:43117");
    assert.equal(first.NESSIE_SIMULATE_COMPLETION, "true");
    assert.equal(first.NESSIE_WHOLE_DOLLARS_ONLY, "true");
    assert.match(first.BETTER_AUTH_SECRET, /^[a-f0-9]{64}$/);
    assert.equal(first.NESSIE_API_KEY, "");
    assert.equal(first.XAI_API_KEY, "");
    const source = readFileSync(join(directory, ".env.local"), "utf8");
    ensureLocalConfig(directory, {});
    assert.equal(readFileSync(join(directory, ".env.local"), "utf8"), source);
    if (process.platform !== "win32") assert.equal(statSync(join(directory, ".env.local")).mode & 0o777, 0o600);
    assert.equal(existsSync(join(directory, "data")), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("setup preserves existing secrets, explicit false flags, custom paths and environment precedence", () => {
  const directory = mkdtempSync(join(tmpdir(), "sentinel-setup-"));
  try {
    writeFileSync(join(directory, ".env"), "BETTER_AUTH_SECRET=existing-secret-at-least-thirty-two-characters\nNESSIE_SIMULATE_COMPLETION=false\nNESSIE_API_KEY=existing-bank-key\nSENTINEL_DB_PATH=custom.sqlite\n");
    writeFileSync(join(directory, ".env.local"), "XAI_API_KEY=local-key\nNESSIE_WHOLE_DOLLARS_ONLY=false\n");
    writeFileSync(join(directory, "custom.sqlite"), "existing database bytes");
    const config = ensureLocalConfig(directory, { XAI_API_KEY: "process-key" });
    assert.equal(config.NESSIE_SIMULATE_COMPLETION, "false");
    assert.equal(config.NESSIE_WHOLE_DOLLARS_ONLY, "false");
    assert.equal(config.NESSIE_API_KEY, "existing-bank-key");
    assert.equal(config.XAI_API_KEY, "process-key");
    assert.equal(config.SENTINEL_DB_PATH, "custom.sqlite");
    assert.equal(config.BETTER_AUTH_SECRET, "existing-secret-at-least-thirty-two-characters");
    assert.equal(readFileSync(join(directory, "custom.sqlite"), "utf8"), "existing database bytes");
    assert(!readFileSync(join(directory, ".env.local"), "utf8").includes("process-key"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("setup refuses to invent a replacement auth secret for an existing database", () => {
  const directory = mkdtempSync(join(tmpdir(), "sentinel-setup-"));
  try {
    mkdirSync(join(directory, "data"));
    writeFileSync(join(directory, "data/sentinel.sqlite"), "existing");
    assert.throws(() => ensureLocalConfig(directory, {}), /original .env.local/);
    assert.equal(existsSync(join(directory, ".env.local")), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("local wizard rejects unauthenticated and cross-origin requests, saves only missing keys and never echoes them", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sentinel-wizard-"));
  const config = ensureLocalConfig(directory, { NESSIE_API_KEY: "existing-private-bank-key" });
  const wizard = await startSetupWizard(directory, config);
  assert(wizard);
  const origin = new URL(wizard.url).origin;
  try {
    const denied = await fetch(origin);
    assert.equal(denied.status, 403);
    const form = await fetch(wizard.url);
    const html = await form.text();
    assert(html.includes("xAI API key"));
    assert(!html.includes("existing-private-bank-key"));
    assert(!html.includes('name="NESSIE_API_KEY"'));
    assert.equal(form.headers.get("referrer-policy"), "strict-origin");
    const malicious = await fetch(wizard.url, { method: "POST", headers: { origin: "https://evil.invalid" }, body: new URLSearchParams({ XAI_API_KEY: "attacker" }) });
    assert.equal(malicious.status, 403);
    const invalid = await fetch(wizard.url, { method: "POST", headers: { origin }, body: new URLSearchParams({ XAI_API_KEY: "key\nAPP_ORIGIN=evil" }) });
    assert.equal(invalid.status, 422);
    assert.equal(readLocalConfig(directory, {}).XAI_API_KEY, "");
    const saved = await fetch(wizard.url, { method: "POST", headers: { origin }, body: new URLSearchParams({ XAI_API_KEY: "new-private-xai-key", BETTER_AUTH_SECRET: "attacker", NESSIE_API_KEY: "attacker" }) });
    assert.equal(saved.status, 200);
    assert(!(await saved.text()).includes("new-private-xai-key"));
    await wizard.done;
    const local = readLocalConfig(directory, {});
    assert.equal(local.XAI_API_KEY, "new-private-xai-key");
    assert.equal(local.BETTER_AUTH_SECRET, config.BETTER_AUTH_SECRET);
    assert.equal(local.NESSIE_API_KEY, undefined, "environment key is never overwritten or copied into the file");
  } finally { wizard.close(); rmSync(directory, { recursive: true, force: true }); }
});

it("a configured installation does not open the key-entry wizard", async () => {
  assert.equal(await startSetupWizard("unused", { NESSIE_API_KEY: "bank", XAI_API_KEY: "xai" }), null);
});

it("migration failures now name missing configuration without printing credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "sentinel-error-"));
  try {
    const env = { ...process.env, APP_ORIGIN: "", BETTER_AUTH_SECRET: "private-test-secret-at-least-thirty-two", NESSIE_API_KEY: "private-bank-key", XAI_API_KEY: "private-xai-key" };
    const result = spawnSync(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("scripts/migrate.ts")], { cwd: directory, env, encoding: "utf8", timeout: 20000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Migration failed:.*APP_ORIGIN/);
    assert(!result.stderr.includes("private-bank-key"));
    assert(!result.stderr.includes("private-test-secret"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("startup error messages redact known secret values", () => {
  process.env.SENTINEL_TEST_API_KEY = "unique-sensitive-fixture-key";
  try { assert.equal(safeStartupMessage(new Error("Failed unique-sensitive-fixture-key")), "Failed [redacted]"); }
  finally { delete process.env.SENTINEL_TEST_API_KEY; }
});
