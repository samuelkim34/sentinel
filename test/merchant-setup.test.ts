import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBankingAdapter, setBankingAdapterForTests } from "../src/banking/adapter";
import { withMerchantSetupLock } from "../src/banking/merchant-setup-lock";
import { confirmMerchantCategory, confirmSuggestedMerchantCategories, listMerchants, syncMerchants } from "../src/domain/accounts";
import { createWorkspace } from "../src/domain/workspaces";
import { resetEnvCache } from "../src/server/env";
import { run } from "../src/storage/sql";
import { fixture, human, testEnv } from "./support";

const originalFetch = globalThis.fetch;
beforeEach(testEnv);
afterEach(() => { globalThis.fetch = originalFetch; setBankingAdapterForTests(null); testEnv(); });

it("web setup creates, imports and reuses 50 merchants without confirming spending categories", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sentinel-web-merchants-"));
  const f = fixture();
  const records: Array<Record<string, unknown>> = [];
  let posts = 0;
  Object.assign(process.env, { NESSIE_API_KEY: "fixture-key", NESSIE_BASE_URL: "https://fixture.invalid", SENTINEL_DB_PATH: join(directory, "test.sqlite") });
  resetEnvCache();
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://fixture.invalid");
    if (init?.method === "POST") {
      posts++;
      const record = { ...JSON.parse(String(init.body)), _id: `merchant-${posts}` };
      records.push(record);
      return Response.json({ objectCreated: record }, { status: 201 });
    }
    if (url.pathname === "/merchants") return Response.json(records);
    const record = records.find(item => item._id === url.pathname.split("/").pop());
    assert(record);
    return Response.json(record);
  };
  try {
    assert.equal((await syncMerchants(f.db, f.owner, f.now)).imported, 0);
    assert.equal(posts, 0, "read-only import never creates merchants");
    const first = await syncMerchants(f.db, f.owner, f.now, true);
    assert.equal(first.imported, 50);
    assert.equal(first.setup?.created, 50);
    const staples = listMerchants(f.db, f.owner).find(item => item.label === "Staples")!;
    assert.equal(staples.verifiedCategory, "UNKNOWN");
    assert.equal(staples.suggestedCategory, "OFFICE");
    const second = await syncMerchants(f.db, f.owner, f.now, true);
    assert.equal(second.setup?.created, 0);
    assert.equal(posts, 50);
    assert.deepEqual(readdirSync(directory), []);
  } finally { f.db.close(); rmSync(directory, { recursive: true, force: true }); }
});

it("only owners may prepare merchants or approve suggestions", async () => {
  const f = fixture();
  run(f.db, "UPDATE memberships SET role = 'member' WHERE workspace_id = ?", [f.workspace.id]);
  const member = human(f.workspace.id, "owner", "member");
  let calls = 0;
  const adapter = getBankingAdapter();
  adapter.prepareSandboxMerchants = async () => { calls++; return { created: 0, renamed: 0, existing: 0 }; };
  setBankingAdapterForTests(adapter);
  try {
    await assert.rejects(syncMerchants(f.db, member, f.now, true), /Only an owner/);
    assert.throws(() => confirmSuggestedMerchantCategories(f.db, member, [{ id: "merchant", category: "OFFICE" }], f.now), /Only an owner/);
    assert.equal(calls, 0);
  } finally { f.db.close(); }
});

function addMerchants(f: ReturnType<typeof fixture>) {
  for (const [id, name] of [["staples", "Staples"], ["target", "Target"]]) {
    run(f.db, "INSERT INTO merchant_catalog (id, upstream_merchant_id, label, raw_category, verified_category, last_synced_at) VALUES (?, ?, ?, 'untrusted', 'UNKNOWN', ?)", [id, `up-${id}`, name, f.now]);
  }
}

it("batch confirmation is workspace-scoped, audited and preserves concurrent owner choices", () => {
  const f = fixture();
  try {
    addMerchants(f);
    const other = createWorkspace(f.db, "other", { kind: "PERSONAL", label: "Other", timezone: "UTC" }, f.now);
    confirmMerchantCategory(f.db, f.owner, "target", "OFFICE", f.now);
    const input = [{ id: "staples", category: "OFFICE" }, { id: "target", category: "OTHER" }];
    assert.deepEqual(confirmSuggestedMerchantCategories(f.db, f.owner, input, f.now), { confirmed: 1, skipped: 1 });
    assert.equal(listMerchants(f.db, f.owner).find(m => m.id === "target")?.verifiedCategory, "OFFICE");
    assert.equal(listMerchants(f.db, human(other.id, "other")).find(m => m.id === "staples")?.verifiedCategory, "UNKNOWN");
    assert.deepEqual(confirmSuggestedMerchantCategories(f.db, f.owner, input, f.now), { confirmed: 0, skipped: 2 });
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE event_type = 'MERCHANT_CATEGORY_CONFIRMED' AND subject_id = 'staples'").get()?.n, 1);
  } finally { f.db.close(); }
});

it("malformed, forged or stale batch suggestions never partially confirm categories", () => {
  const f = fixture();
  try {
    addMerchants(f);
    for (const input of [null, [], [null], [{ id: "staples", category: "OFFICE" }, { id: "target", category: "SOFTWARE" }], [{ id: "missing", category: "OFFICE" }], [{ id: "staples", category: "OFFICE" }, { id: "staples", category: "OFFICE" }]]) {
      assert.throws(() => confirmSuggestedMerchantCategories(f.db, f.owner, input, f.now));
      assert.equal(listMerchants(f.db, f.owner).find(m => m.id === "staples")?.verifiedCategory, "UNKNOWN");
    }
    run(f.db, "UPDATE merchant_catalog SET label = 'Different business' WHERE id = 'staples'");
    assert.throws(() => confirmSuggestedMerchantCategories(f.db, f.owner, [{ id: "staples", category: "OFFICE" }], f.now), /changed/);
  } finally { f.db.close(); }
});

it("web and CLI setup lock rejects overlapping writes and releases after failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sentinel-lock-"));
  const config = { baseUrl: "https://fixture.invalid", apiKey: "fixture", dbPath: join(directory, "test.sqlite") };
  try {
    await assert.rejects(withMerchantSetupLock(config, async () => {
      await assert.rejects(withMerchantSetupLock(config, async () => assert.fail("overlapping writer")), /already running/);
      throw new Error("provider failure");
    }), /provider failure/);
    assert.deepEqual(readdirSync(directory), []);
    assert.equal(await withMerchantSetupLock(config, async () => "released"), "released");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
