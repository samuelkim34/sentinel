import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { openDatabase, row, run } from "../src/storage/sql";
import { migrateApplication } from "../src/storage/migrate";
import { resetEnvCache } from "../src/server/env";
import { createWorkspace, updateMember } from "../src/domain/workspaces";
import { createConnection, createMandate, createRegistration, pauseRegistration } from "../src/domain/authority";
import { approveProposal, claimTask, createTask, submitPurchase } from "../src/domain/proposals";
import { listWallets } from "../src/domain/accounts";
import { applyReceipt, recoverSubmitting, submitPayment } from "../src/domain/settlement";
import { setBankingAdapterForTests } from "../src/banking/adapter";
import { BankOperationError, type BankingAdapter, type PurchaseReceipt } from "../src/banking/types";
import { AppError } from "../src/contracts/errors";
import type { DatabaseSync } from "node:sqlite";
import type { ConnectorContext, HumanContext } from "../src/domain/access";

const now = Date.now();

before(() => {
  process.env.APP_ORIGIN = "http://127.0.0.1:43117";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";
  process.env.BETTER_AUTH_URL = "http://127.0.0.1:43117";
  process.env.SENTINEL_DB_PATH = ":memory:";
  process.env.BANK_FRESHNESS_SECONDS = "60";
  process.env.TASK_LEASE_SECONDS = "300";
  resetEnvCache();
});

function db(): DatabaseSync {
  const database = openDatabase(":memory:");
  migrateApplication(database);
  return database;
}

function human(workspaceId: string, userId = "owner", role: HumanContext["role"] = "owner"): HumanContext {
  return { kind: "human", userId, workspaceId, role, sessionId: `session-${userId}` };
}

function reauth(database: DatabaseSync, userId: string) {
  run(database, "INSERT INTO reauth_grants (session_id, user_id, expires_at) VALUES (?, ?, ?)", [`session-${userId}`, userId, now + 60_000]);
}

function wallet(database: DatabaseSync, workspaceId: string) {
  run(database, "INSERT INTO bank_integrations (id, workspace_id, provider, credential_source, customer_id, configuration_state, last_verified_at) VALUES ('int', ?, 'NESSIE', 'ENV', 'cust', 'LINKED', ?)", [workspaceId, now]);
  run(database, "INSERT INTO wallets (id, workspace_id, integration_id, upstream_account_id, upstream_customer_id, label, currency, policy_balance_cents, state, last_verified_at, version) VALUES ('wal', ?, 'int', 'acct-1', 'cust', 'Sandbox', 'USD', 10000, 'ACTIVE', ?, 1)", [workspaceId, now]);
  run(database, "INSERT INTO merchant_catalog (id, upstream_merchant_id, label, raw_category, verified_category, last_synced_at) VALUES ('mer', 'up-mer', 'Market', 'grocery', 'GROCERIES', ?)", [now]);
}

function adapter(create: BankingAdapter["createPurchase"]): BankingAdapter {
  const receipt = (state: PurchaseReceipt["state"]): PurchaseReceipt => ({
    externalId: "purchase-1",
    state,
    amountCents: 1500,
    merchantExternalId: "up-mer",
    accountExternalId: "acct-1",
    reference: "sentinel",
    responseId: "resp",
  });
  return {
    provider: "NESSIE",
    getAccount: async () => ({ externalId: "acct-1", customerExternalId: "cust", label: "Sandbox", currency: "USD", balanceCents: 10000, observedAt: now, responseId: null }),
    listCustomerAccounts: async () => [],
    listMerchants: async () => ({ merchants: [], supported: false }),
    listPurchases: async () => ({ purchases: [], definitive: false }),
    listBills: async () => ({ bills: [], supported: false }),
    listTransfers: async () => ({ transfers: [], supported: false }),
    createPurchase: create,
    getPurchase: async () => receipt("COMPLETED"),
    findPurchaseByReference: async () => ({ supported: false }),
  };
}

describe("installed database", () => {
  it("starts with no agents, tasks, or proposals", () => {
    const database = db();
    for (const table of ["registrations", "tasks", "proposals", "mandates", "wallets"]) {
      assert.equal(Number(row(database, `SELECT COUNT(*) AS c FROM ${table}`)?.c), 0);
    }
  });

  it("refuses a newer schema version", () => {
    const database = db();
    run(database, "UPDATE app_meta SET value = '99' WHERE key = 'schema_version'");
    assert.throws(() => migrateApplication(database), /newer than this application/);
  });
});

describe("workspaces", () => {
  it("keeps accounts inside the workspace that linked them", () => {
    const database = db();
    const first = createWorkspace(database, "owner", { kind: "PERSONAL", label: "Home", timezone: "UTC" }, now);
    const second = createWorkspace(database, "owner", { kind: "PERSONAL", label: "Other", timezone: "UTC" }, now);
    wallet(database, first.id);
    assert.equal(listWallets(database, human(first.id)).length, 1);
    assert.equal(listWallets(database, human(second.id)).length, 0);
  });

  it("refuses to remove the last owner", () => {
    const database = db();
    const workspace = createWorkspace(database, "owner", { kind: "BUSINESS", label: "Shop", timezone: "UTC" }, now);
    assert.throws(
      () => updateMember(database, human(workspace.id), "owner", { state: "REMOVED", expectedVersion: 1 }, now),
      (error: unknown) => error instanceof AppError && error.code === "LAST_OWNER",
    );
  });
});

describe("purchases", () => {
  it("keeps propose-only work unreserved until another person approves it", () => {
    const database = db();
    const workspace = createWorkspace(database, "owner", { kind: "BUSINESS", label: "Shop", timezone: "UTC" }, now);
    run(database, "INSERT INTO memberships (workspace_id, user_id, role, state, joined_at, version) VALUES (?, 'finance', 'finance', 'ACTIVE', ?, 1)", [workspace.id, now]);
    reauth(database, "owner");
    reauth(database, "finance");
    wallet(database, workspace.id);
    const registration = createRegistration(database, human(workspace.id), { name: "Buyer", purpose: "Groceries", walletIds: [] }, now);
    const mandate = createMandate(database, human(workspace.id), {
      registrationId: registration.id,
      walletId: "wal",
      totalAllowance: "100.00",
      perPurchaseLimit: "50.00",
      reviewAbove: "20.00",
      allowedCategories: ["GROCERIES"],
      allowedMerchantIds: null,
      executionMode: "PROPOSE_ONLY",
      expiresAt: now + 86_400_000,
    }, now);
    const task = createTask(database, human(workspace.id), {
      registrationId: registration.id,
      kind: "PURCHASE",
      title: "Milk",
      requestedOutcome: "Buy milk",
      mandateId: mandate.id,
      requestKey: "task-1",
    }, now);
    const again = createTask(database, human(workspace.id), {
      registrationId: registration.id,
      kind: "PURCHASE",
      title: "Milk",
      requestedOutcome: "Buy milk",
      mandateId: mandate.id,
      requestKey: "task-1",
    }, now);
    assert.equal(again.id, task.id);
    const connection = createConnection(database, human(workspace.id), registration.id, "OAUTH", now);
    const ctx: ConnectorContext = {
      kind: "connector",
      userId: "owner",
      workspaceId: workspace.id,
      registrationId: registration.id,
      connectionId: connection.id,
      scopes: new Set(["context:read", "tasks:read", "tasks:update", "proposals:write"]),
    };
    const claim = claimTask(database, ctx, task.id, now);
    const proposal = submitPurchase(database, ctx, {
      taskId: task.id,
      revision: claim.task.revision,
      leaseToken: claim.leaseToken,
      merchantId: "mer",
      amountCents: 1500,
      reason: "Milk",
    }, now);
    assert.equal(proposal.state, "REVIEW_REQUIRED");
    assert.equal(row(database, "SELECT COUNT(*) AS c FROM reservations")?.c, 0);
    assert.throws(
      () => approveProposal(database, human(workspace.id), proposal.id, proposal.termsHash, now),
      (error: unknown) => error instanceof AppError && error.code === "SELF_APPROVAL",
    );
    const approved = approveProposal(database, human(workspace.id, "finance", "finance"), proposal.id, proposal.termsHash, now);
    assert.equal(approved.state, "RESERVED");
    assert.equal(row(database, "SELECT COUNT(*) AS c FROM reservations")?.c, 1);
  });

  it("releases an unsubmitted hold on pause and leaves a submitted operation alone", () => {
    const database = db();
    const workspace = createWorkspace(database, "owner", { kind: "PERSONAL", label: "Home", timezone: "UTC" }, now);
    reauth(database, "owner");
    wallet(database, workspace.id);
    const registration = createRegistration(database, human(workspace.id), { name: "Buyer", purpose: "Groceries", walletIds: ["wal"] }, now);
    const mandate = createMandate(database, human(workspace.id), {
      registrationId: registration.id,
      walletId: "wal",
      totalAllowance: "100.00",
      perPurchaseLimit: "50.00",
      reviewAbove: "20.00",
      allowedCategories: ["GROCERIES"],
      allowedMerchantIds: null,
      executionMode: "AUTO_WITHIN_LIMITS",
      expiresAt: now + 86_400_000,
    }, now);
    const task = createTask(database, human(workspace.id), {
      registrationId: registration.id,
      kind: "PURCHASE",
      title: "Milk",
      requestedOutcome: "Buy milk",
      mandateId: mandate.id,
    }, now);
    const connection = createConnection(database, human(workspace.id), registration.id, "OAUTH", now);
    const ctx: ConnectorContext = {
      kind: "connector",
      userId: "owner",
      workspaceId: workspace.id,
      registrationId: registration.id,
      connectionId: connection.id,
      scopes: new Set(connection.scopes),
    };
    const claim = claimTask(database, ctx, task.id, now);
    const proposal = submitPurchase(database, ctx, {
      taskId: task.id,
      revision: 1,
      leaseToken: claim.leaseToken,
      merchantId: "mer",
      amountCents: 1500,
      reason: "Milk",
    }, now);
    assert.equal(proposal.state, "RESERVED");
    pauseRegistration(database, human(workspace.id), registration.id, now);
    assert.equal(row(database, "SELECT state FROM proposals WHERE id = ?", [proposal.id])?.state, "CANCELLED");
    assert.equal(row(database, "SELECT COUNT(*) AS c FROM reservations")?.c, 0);
  });

  it("submits a reserved purchase once and keeps the hold after an uncertain result", async () => {
    const database = db();
    const workspace = createWorkspace(database, "owner", { kind: "PERSONAL", label: "Home", timezone: "UTC" }, now);
    reauth(database, "owner");
    wallet(database, workspace.id);
    const registration = createRegistration(database, human(workspace.id), { name: "Buyer", purpose: "Groceries", walletIds: ["wal"] }, now);
    const mandate = createMandate(database, human(workspace.id), {
      registrationId: registration.id,
      walletId: "wal",
      totalAllowance: "100.00",
      perPurchaseLimit: "50.00",
      reviewAbove: "20.00",
      allowedCategories: ["GROCERIES"],
      allowedMerchantIds: null,
      executionMode: "AUTO_WITHIN_LIMITS",
      expiresAt: now + 86_400_000,
    }, now);
    const task = createTask(database, human(workspace.id), {
      registrationId: registration.id,
      kind: "PURCHASE",
      title: "Milk",
      requestedOutcome: "Buy milk",
      mandateId: mandate.id,
    }, now);
    const connection = createConnection(database, human(workspace.id), registration.id, "OAUTH", now);
    const ctx: ConnectorContext = {
      kind: "connector",
      userId: "owner",
      workspaceId: workspace.id,
      registrationId: registration.id,
      connectionId: connection.id,
      scopes: new Set(connection.scopes),
    };
    const claim = claimTask(database, ctx, task.id, now);
    const proposal = submitPurchase(database, ctx, {
      taskId: task.id,
      revision: 1,
      leaseToken: claim.leaseToken,
      merchantId: "mer",
      amountCents: 1500,
      reason: "Milk",
    }, now);
    let calls = 0;
    setBankingAdapterForTests(adapter(async () => {
      calls += 1;
      return { externalId: "purchase-1", state: "COMPLETED", amountCents: 1500, merchantExternalId: "up-mer", accountExternalId: "acct-1", reference: null, responseId: null };
    }));
    await submitPayment(database, proposal.id, now);
    await submitPayment(database, proposal.id, now);
    assert.equal(calls, 1);
    assert.equal(row(database, "SELECT policy_balance_cents FROM wallets WHERE id = 'wal'")?.policy_balance_cents, 8500);
    const operationId = String(row(database, "SELECT id FROM payment_operations WHERE proposal_id = ?", [proposal.id])?.id);
    applyReceipt(database, proposal.id, operationId, {
      externalId: "purchase-1",
      state: "COMPLETED",
      amountCents: 1500,
      merchantExternalId: "up-mer",
      accountExternalId: "acct-1",
      reference: null,
      responseId: null,
    }, now);
    assert.equal(row(database, "SELECT policy_balance_cents FROM wallets WHERE id = 'wal'")?.policy_balance_cents, 8500);

    const second = createTask(database, human(workspace.id), {
      registrationId: registration.id,
      kind: "PURCHASE",
      title: "Bread",
      requestedOutcome: "Buy bread",
      mandateId: mandate.id,
    }, now + 1);
    const secondClaim = claimTask(database, ctx, second.id, now + 1);
    const uncertain = submitPurchase(database, ctx, {
      taskId: second.id,
      revision: 1,
      leaseToken: secondClaim.leaseToken,
      merchantId: "mer",
      amountCents: 1500,
      reason: "Bread",
    }, now + 1);
    setBankingAdapterForTests(adapter(async () => {
      throw new BankOperationError("TIMEOUT", "timed out");
    }));
    await submitPayment(database, uncertain.id, now + 1);
    assert.equal(row(database, "SELECT state FROM proposals WHERE id = ?", [uncertain.id])?.state, "RECONCILE_REQUIRED");
    assert.equal(row(database, "SELECT COUNT(*) AS c FROM reservations WHERE proposal_id = ?", [uncertain.id])?.c, 1);
    recoverSubmitting(database, now + 2);
    setBankingAdapterForTests(null);
  });
});

describe("two database connections", () => {
  it("allows only one unresolved payment operation per wallet", () => {
    const path = join(mkdtempSync(join(tmpdir(), "sentinel-")), "race.sqlite");
    const first = openDatabase(path);
    migrateApplication(first);
    const workspace = createWorkspace(first, "owner", { kind: "PERSONAL", label: "Home", timezone: "UTC" }, now);
    wallet(first, workspace.id);
    run(first, "INSERT INTO registrations (id, workspace_id, controller_user_id, name, purpose, state, created_by, version, created_at) VALUES ('reg', ?, 'owner', 'Bot', 'Buy', 'ACTIVE', 'owner', 1, ?)", [workspace.id, now]);
    run(first, "INSERT INTO mandates (id, workspace_id, registration_id, controller_user_id, wallet_id, currency, total_allowance_cents, per_purchase_limit_cents, review_above_cents, allowed_categories, execution_mode, expires_at, created_by, state, created_at) VALUES ('man', ?, 'reg', 'owner', 'wal', 'USD', 10000, 5000, 2000, '[\"GROCERIES\"]', 'PROPOSE_ONLY', ?, 'owner', 'ACTIVE', ?)", [workspace.id, now + 1000, now]);
    run(first, "INSERT INTO tasks (id, workspace_id, registration_id, controller_user_id, mandate_id, wallet_id, kind, title, requested_outcome, revision, state, created_by, intent_author_user_id, version, created_at, updated_at) VALUES ('t1', ?, 'reg', 'owner', 'man', 'wal', 'PURCHASE', 'One', 'One', 1, 'WAITING_PAYMENT', 'owner', 'owner', 1, ?, ?)", [workspace.id, now, now]);
    run(first, "INSERT INTO tasks (id, workspace_id, registration_id, controller_user_id, mandate_id, wallet_id, kind, title, requested_outcome, revision, state, created_by, intent_author_user_id, version, created_at, updated_at) VALUES ('t2', ?, 'reg', 'owner', 'man', 'wal', 'PURCHASE', 'Two', 'Two', 1, 'WAITING_PAYMENT', 'owner', 'owner', 1, ?, ?)", [workspace.id, now, now]);
    run(first, "INSERT INTO proposals (id, workspace_id, task_id, task_revision, mandate_id, wallet_id, requester_user_id, registration_id, merchant_id, currency, amount_cents, reason, terms_hash, state, decision_codes, explanation, created_at, updated_at) VALUES ('p1', ?, 't1', 1, 'man', 'wal', 'owner', 'reg', 'mer', 'USD', 100, 'x', 'h1', 'SUBMITTING', '[]', 'x', ?, ?)", [workspace.id, now, now]);
    run(first, "INSERT INTO proposals (id, workspace_id, task_id, task_revision, mandate_id, wallet_id, requester_user_id, registration_id, merchant_id, currency, amount_cents, reason, terms_hash, state, decision_codes, explanation, created_at, updated_at) VALUES ('p2', ?, 't2', 1, 'man', 'wal', 'owner', 'reg', 'mer', 'USD', 100, 'x', 'h2', 'SUBMITTING', '[]', 'x', ?, ?)", [workspace.id, now, now]);
    const second = openDatabase(path);
    run(first, "INSERT INTO payment_operations (id, proposal_id, wallet_id, upstream_reference, state, submission_count) VALUES ('op1', 'p1', 'wal', 'ref-1', 'SUBMITTING', 1)");
    assert.throws(() => run(second, "INSERT INTO payment_operations (id, proposal_id, wallet_id, upstream_reference, state, submission_count) VALUES ('op2', 'p2', 'wal', 'ref-2', 'SUBMITTING', 1)"));
    first.close();
    second.close();
  });
});
