import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { AppError } from "../src/contracts/errors";
import { BankOperationError } from "../src/banking/types";
import { setBankingAdapterForTests } from "../src/banking/adapter";
import { effectiveCategory, listMerchants, syncMerchants } from "../src/domain/accounts";
import { getRegistration, revokeConnection } from "../src/domain/authority";
import { createAgent } from "../src/domain/agents";
import { banking, fixture, testEnv } from "./support";

beforeEach(testEnv);
afterEach(() => setBankingAdapterForTests(null));

it("a revoked external connection is no longer returned as the current setup connection", () => {
  const f = fixture();
  assert.equal(getRegistration(f.db, f.owner, f.registration.id).setup.connectionId, f.connection.id);
  revokeConnection(f.db, f.owner, f.connection.id, f.now);
  const updated = getRegistration(f.db, f.owner, f.registration.id);
  assert.equal(updated.setup.connectionId, null);
  assert.equal(updated.setup.connectionState, "REVOKED");
  assert.equal(updated.toolsVerifiedAt, null);
  f.db.close();
});

it("an on-site principal is never presented as an external setup connection", () => {
  const f = fixture();
  const agent = createAgent(f.db, f.owner, { name: "Owned agent", purpose: "Recorded research", instructions: "", walletIds: [] }, f.now);
  assert.equal(getRegistration(f.db, f.owner, agent.id).setup.connectionId, null);
  f.db.close();
});

it("merchant sync preserves confirmed categories and distinguishes zero imported from failure", async () => {
  const f = fixture();
  const adapter = banking(async () => { throw new Error("No payments in this test"); });
  adapter.listMerchants = async () => ({ supported: true, merchants: [{ externalId: "up-merchant", label: "Updated bank label", rawCategory: "New upstream category" }] });
  setBankingAdapterForTests(adapter);
  assert.equal((await syncMerchants(f.db, f.owner, f.now)).imported, 1);
  assert.equal(listMerchants(f.db, f.owner)[0]?.label, "Updated bank label");
  assert.equal(effectiveCategory(f.db, f.workspace.id, "merchant", "UNKNOWN"), "GROCERIES");
  adapter.listMerchants = async () => ({ supported: true, merchants: [] });
  assert.equal((await syncMerchants(f.db, f.owner, f.now)).imported, 0);
  assert.equal(listMerchants(f.db, f.owner).length, 1);
  adapter.listMerchants = async () => { throw new BankOperationError("REJECTED", "Nessie rejected the request (401)."); };
  await assert.rejects(syncMerchants(f.db, f.owner, f.now), error => error instanceof AppError && error.code === "MERCHANT_SYNC_REJECTED" && error.message.includes("401"));
  assert.equal(listMerchants(f.db, f.owner).length, 1);
  f.db.close();
});
