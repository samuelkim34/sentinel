import assert from "node:assert/strict";
import { beforeEach, afterEach, it } from "node:test";
import { AppError } from "../src/contracts/errors";
import { atomic, row, run } from "../src/storage/sql";
import { createProtection, updateProtection, confirmMerchantCategory, effectiveCategory, establishBaseline, getWallet } from "../src/domain/accounts";
import { createConnection, createRegistration, pauseRegistration, resumeRegistration, revokeConnection } from "../src/domain/authority";
import { createWorkspace, updateMember } from "../src/domain/workspaces";
import { cancelProposal, submitPurchase, createTask, claimTask, updateTask } from "../src/domain/proposals";
import { recoverClaimedJobs, recoverSubmitting, reconcilePayment, submitPayment } from "../src/domain/settlement";
import { setBankingAdapterForTests } from "../src/banking/adapter";
import { BankOperationError } from "../src/banking/types";
import { testEnv, fixture, human, banking, receipt } from "./support";

beforeEach(testEnv);
afterEach(() => setBankingAdapterForTests(null));
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;

it("nested transactions roll back an inner mutation with the outer journal", () => {
  const f = fixture();
  assert.throws(() => atomic(f.db, () => { createTask(f.db, f.owner, { registrationId: f.registration.id, kind: "RESEARCH", title: "Nested", requestedOutcome: "Nested" }, f.now); throw new Error("journal failed"); }));
  assert.equal(row(f.db, "SELECT COUNT(*) AS count FROM tasks")?.count, 0); f.db.close();
});

it("workspace creation replays identical requests and rejects changed terms", () => {
  const f = fixture(); const input = { kind: "PERSONAL" as const, label: "New", timezone: "UTC" };
  const a = createWorkspace(f.db, "owner", input, f.now, "workspace-key");
  assert.equal(createWorkspace(f.db, "owner", input, f.now, "workspace-key").id, a.id);
  assert.throws(() => createWorkspace(f.db, "owner", { ...input, label: "Changed" }, f.now, "workspace-key"), code("IDEMPOTENCY_CONFLICT")); f.db.close();
});

it("new protection shortfalls do not count the new floor twice", () => {
  const f = fixture(); assert.equal(createProtection(f.db, f.owner, { walletId: "wallet", label: "Rent", amount: "60.00" }, f.now).shortfallCents, 0); f.db.close();
});

it("reactivating a protection cannot undercut an existing hold", () => {
  const f = fixture(); const protection = createProtection(f.db, f.owner, { walletId: "wallet", label: "Rent", amount: "90.00" }, f.now);
  updateProtection(f.db, f.owner, protection.id, { state: "DISABLED", expectedVersion: 1 }, f.now);
  f.purchase();
  assert.throws(() => updateProtection(f.db, f.owner, protection.id, { state: "ACTIVE", expectedVersion: 2 }, f.now), code("PROTECTION_CONFLICT")); f.db.close();
});

it("merchant category confirmation stays in the owner's workspace", () => {
  const f = fixture(); const other = createWorkspace(f.db, "owner", { kind: "PERSONAL", label: "Other", timezone: "UTC" }, f.now);
  assert.equal(effectiveCategory(f.db, other.id, "merchant", "UNKNOWN"), "UNKNOWN");
  confirmMerchantCategory(f.db, human(other.id), "merchant", "OFFICE", f.now);
  assert.equal(effectiveCategory(f.db, f.workspace.id, "merchant", "UNKNOWN"), "GROCERIES"); f.db.close();
});

it("finance cannot grant itself business account access or create a personal connector token", () => {
  const f = fixture("BUSINESS"); run(f.db, "INSERT INTO memberships (workspace_id, user_id, role, state, joined_at, version) VALUES (?, 'finance', 'finance', 'ACTIVE', ?, 1)", [f.workspace.id, f.now]);
  assert.throws(() => createRegistration(f.db, human(f.workspace.id, "finance", "finance"), { name: "Escalation", purpose: "Escalation", walletIds: ["wallet"] }, f.now), code("READ_GRANT_FORBIDDEN"));
  assert.throws(() => createConnection(f.db, f.owner, f.registration.id, "PERSONAL_TOKEN", f.now), code("PERSONAL_TOKEN_FORBIDDEN")); f.db.close();
});

it("a member cannot cancel another person's proposal or view their account operations", () => {
  const f = fixture("BUSINESS"); const p = f.purchase();
  run(f.db, "INSERT INTO memberships (workspace_id, user_id, role, state, joined_at, version) VALUES (?, 'member', 'member', 'ACTIVE', ?, 1)", [f.workspace.id, f.now]);
  const reg = createRegistration(f.db, f.owner, { name: "Member", purpose: "Member", walletIds: ["wallet"], controllerUserId: "member" }, f.now);
  assert.ok(reg.id);
  assert.throws(() => cancelProposal(f.db, human(f.workspace.id, "member", "member"), p.proposal.id, f.now), code("TASK_MISSING"));
  assert.equal(getWallet(f.db, human(f.workspace.id, "member", "member"), "wallet").operations.length, 0); f.db.close();
});

it("revoking a connection invalidates a held lease and blocks unsubmitted payment", async () => {
  const f = fixture(); const p = f.purchase(); revokeConnection(f.db, f.owner, f.connection.id, f.now);
  assert.throws(() => updateTask(f.db, f.ctx, { taskId: p.task.id, revision: 1, leaseToken: p.claim.leaseToken, phase: "working", note: "update", evidence: [] }, f.now), code("CONNECTION_REVOKED"));
  let writes = 0; setBankingAdapterForTests(banking(async () => { writes++; return receipt(); }));
  await submitPayment(f.db, p.proposal.id, f.now); assert.equal(writes, 0); assert.equal(row(f.db, "SELECT COUNT(*) AS c FROM reservations")?.c, 0); f.db.close();
});

it("pause and resume allow a fresh revision without recycling cancelled terms", () => {
  const f = fixture(); const p = f.purchase(); pauseRegistration(f.db, f.owner, f.registration.id, f.now); resumeRegistration(f.db, f.owner, f.registration.id, f.now);
  assert.equal(row(f.db, "SELECT revision FROM tasks WHERE id = ?", [p.task.id])?.revision, 2);
  assert.equal(claimTask(f.db, f.ctx, p.task.id, f.now).task.revision, 2); f.db.close();
});

it("an unknown merchant is a validation error before a proposal is inserted", () => {
  const f = fixture(); const task = createTask(f.db, f.owner, { registrationId: f.registration.id, kind: "PURCHASE", title: "Unknown", requestedOutcome: "Unknown", mandateId: f.mandate.id }, f.now); const claim = claimTask(f.db, f.ctx, task.id, f.now);
  assert.throws(() => submitPurchase(f.db, f.ctx, { taskId: task.id, revision: 1, leaseToken: claim.leaseToken, merchantId: "missing", amountCents: 100, reason: "Test" }, f.now), code("MERCHANT_UNKNOWN")); f.db.close();
});

it("a stale observation cannot become a new policy baseline", () => {
  const f = fixture(); run(f.db, "UPDATE bank_observations SET observed_at = ?", [f.now - 61000]);
  assert.throws(() => establishBaseline(f.db, f.owner, "wallet", f.now), code("BANK_STATE_STALE")); f.db.close();
});

it("owner and finance promotions require a fresh password check", () => {
  const f = fixture("BUSINESS"); run(f.db, "INSERT INTO memberships (workspace_id, user_id, role, state, joined_at, version) VALUES (?, 'member', 'member', 'ACTIVE', ?, 1)", [f.workspace.id, f.now]); run(f.db, "DELETE FROM reauth_grants");
  assert.throws(() => updateMember(f.db, f.owner, "member", { role: "finance", expectedVersion: 1 }, f.now), code("REAUTHENTICATION_REQUIRED")); f.db.close();
});

it("a receipt for a different account never completes a purchase or releases its hold", async () => {
  const f = fixture(); const p = f.purchase(); setBankingAdapterForTests(banking(async () => ({ ...receipt(), accountExternalId: "wrong-account" })));
  await submitPayment(f.db, p.proposal.id, f.now); assert.equal(row(f.db, "SELECT state FROM proposals WHERE id = ?", [p.proposal.id])?.state, "RECONCILE_REQUIRED"); assert.equal(row(f.db, "SELECT COUNT(*) AS c FROM reservations")?.c, 1); f.db.close();
});

it("pending receipts exhaust bounded read attempts while retaining the hold", async () => {
  const f = fixture(); const p = f.purchase(); let writes = 0;
  setBankingAdapterForTests(banking(async () => { writes++; return receipt("PENDING"); }, async () => receipt("PENDING")));
  await submitPayment(f.db, p.proposal.id, f.now);
  for (let attempt = 0; attempt < 3; attempt++) await reconcilePayment(f.db, p.proposal.id, f.now + (attempt + 1) * 10000);
  assert.equal(writes, 1); const op = row(f.db, "SELECT manual_review, attempt_count FROM payment_operations WHERE proposal_id = ?", [p.proposal.id]); assert.equal(op?.manual_review, 1); assert.equal(op?.attempt_count, 3); assert.equal(row(f.db, "SELECT COUNT(*) AS c FROM jobs WHERE kind = 'reconcile' AND state = 'DUE'")?.c, 0); assert.equal(row(f.db, "SELECT COUNT(*) AS c FROM reservations")?.c, 1); f.db.close();
});

it("missing or ambiguous receipts never authorize another POST", async () => {
  const f = fixture(); const p = f.purchase(); let writes = 0;
  setBankingAdapterForTests(banking(async () => { writes++; throw new BankOperationError("TIMEOUT", "Fixture timeout"); }, async () => null));
  await submitPayment(f.db, p.proposal.id, f.now); await reconcilePayment(f.db, p.proposal.id, f.now + 5000); await submitPayment(f.db, p.proposal.id, f.now + 5000);
  assert.equal(writes, 1); assert.equal(row(f.db, "SELECT COUNT(*) AS c FROM reservations")?.c, 1); f.db.close();
});

it("crash recovery requeues a stale pre-submission job but never a recorded submission", async () => {
  const f = fixture(); const p = f.purchase(); run(f.db, "UPDATE jobs SET state = 'CLAIMED', claimed_at = ?", [f.now - 121000]); recoverClaimedJobs(f.db, f.now);
  assert.equal(row(f.db, "SELECT state FROM jobs WHERE kind = 'payment'")?.state, "DUE");
  setBankingAdapterForTests(banking(async () => { throw new BankOperationError("TIMEOUT", "Fixture timeout"); })); await submitPayment(f.db, p.proposal.id, f.now);
  run(f.db, "UPDATE jobs SET state = 'CLAIMED', claimed_at = ? WHERE kind = 'payment'", [f.now - 121000]); recoverClaimedJobs(f.db, f.now);
  assert.equal(row(f.db, "SELECT state FROM jobs WHERE kind = 'payment'")?.state, "DONE"); f.db.close();
});

it("interrupted submitting operations wait beyond the provider deadline before recovery", () => {
  const f = fixture(); const p = f.purchase(); run(f.db, "INSERT INTO payment_operations (id, proposal_id, wallet_id, upstream_reference, state, submission_count, submitted_at) VALUES ('op', ?, 'wallet', 'sentinel-op', 'SUBMITTING', 1, ?)", [p.proposal.id, f.now]); run(f.db, "UPDATE proposals SET state = 'SUBMITTING' WHERE id = ?", [p.proposal.id]);
  recoverSubmitting(f.db, f.now + 1000); assert.equal(row(f.db, "SELECT state FROM payment_operations WHERE id = 'op'")?.state, "SUBMITTING");
  recoverSubmitting(f.db, f.now + 121000); assert.equal(row(f.db, "SELECT state FROM payment_operations WHERE id = 'op'")?.state, "RECONCILE_REQUIRED"); f.db.close();
});
