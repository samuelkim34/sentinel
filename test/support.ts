import type { DatabaseSync } from "node:sqlite";
import { openDatabase, run } from "../src/storage/sql";
import { migrateApplication } from "../src/storage/migrate";
import { resetEnvCache } from "../src/server/env";
import { createWorkspace } from "../src/domain/workspaces";
import { createConnection, createMandate, createRegistration } from "../src/domain/authority";
import { createTask, claimTask, submitPurchase } from "../src/domain/proposals";
import { confirmMerchantCategory } from "../src/domain/accounts";
import type { ConnectorContext, HumanContext } from "../src/domain/access";
import type { BankingAdapter, PurchaseReceipt } from "../src/banking/types";

export function testEnv() {
  Object.assign(process.env, { APP_ORIGIN: "http://127.0.0.1:43117", BETTER_AUTH_URL: "http://127.0.0.1:43117", BETTER_AUTH_SECRET: "isolated-test-secret-with-at-least-32-characters", SENTINEL_DB_PATH: ":memory:", ALLOWED_ORIGINS: "", NESSIE_API_KEY: "", XAI_API_KEY: "", BANK_FRESHNESS_SECONDS: "60", RECONCILE_MAX_ATTEMPTS: "3", ENABLE_MCP_DCR: "false", SOURCE_REPOSITORY_URL: "" });
  resetEnvCache();
}

export function human(workspaceId: string, userId = "owner", role: HumanContext["role"] = "owner"): HumanContext { return { kind: "human", workspaceId, userId, role, sessionId: `session-${userId}` }; }
export function reauth(db: DatabaseSync, userId: string, now: number) { run(db, "INSERT OR REPLACE INTO reauth_grants (session_id, user_id, expires_at) VALUES (?, ?, ?)", [`session-${userId}`, userId, now + 300000]); }

export function fixture(kind: "PERSONAL" | "BUSINESS" = "PERSONAL") {
  const now = Date.now();
  const db = openDatabase(":memory:"); migrateApplication(db);
  const workspace = createWorkspace(db, "owner", { kind, label: "Isolated test workspace", timezone: "UTC" }, now);
  const owner = human(workspace.id); reauth(db, "owner", now);
  run(db, "INSERT INTO bank_integrations (id, workspace_id, provider, credential_source, customer_id, configuration_state) VALUES ('int', ?, 'NESSIE', 'ENV', 'customer', 'LINKED')", [workspace.id]);
  run(db, "INSERT INTO wallets (id, workspace_id, integration_id, upstream_account_id, upstream_customer_id, label, currency, policy_balance_cents, state, last_verified_at, version) VALUES ('wallet', ?, 'int', 'account', 'customer', 'Fixture account', 'USD', 10000, 'ACTIVE', ?, 1)", [workspace.id, now]);
  run(db, "INSERT INTO bank_observations (id, wallet_id, observed_balance_cents, observed_at, source, validation_state) VALUES ('observation', 'wallet', 10000, ?, 'NESSIE', 'VALID')", [now]);
  run(db, "INSERT INTO merchant_catalog (id, upstream_merchant_id, label, raw_category, verified_category, last_synced_at) VALUES ('merchant', 'up-merchant', 'Fixture merchant', 'grocery', 'UNKNOWN', ?)", [now]);
  confirmMerchantCategory(db, owner, "merchant", "GROCERIES", now);
  const registration = createRegistration(db, owner, { name: "Fixture Bot", purpose: "Only exists inside this test", walletIds: ["wallet"] }, now);
  const connection = createConnection(db, owner, registration.id, kind === "PERSONAL" ? "PERSONAL_TOKEN" : "OAUTH", now);
  const ctx: ConnectorContext = { kind: "connector", workspaceId: workspace.id, userId: "owner", registrationId: registration.id, connectionId: connection.id, scopes: new Set(connection.scopes) };
  const mandate = createMandate(db, owner, { registrationId: registration.id, walletId: "wallet", totalAllowance: "100.00", perPurchaseLimit: "50.00", reviewAbove: "50.00", allowedCategories: ["GROCERIES"], allowedMerchantIds: null, executionMode: "AUTO_WITHIN_LIMITS", expiresAt: now + 86400000 }, now);
  function purchase() {
    const task = createTask(db, owner, { registrationId: registration.id, kind: "PURCHASE", title: "Fixture purchase", requestedOutcome: "Test a purchase", mandateId: mandate.id }, now);
    const claim = claimTask(db, ctx, task.id, now);
    const terms = { taskId: task.id, revision: 1, leaseToken: claim.leaseToken, merchantId: "merchant", amountCents: 1500, reason: "Fixture" };
    return { task, claim, terms, proposal: submitPurchase(db, ctx, terms, now) };
  }
  return { db, now, workspace, owner, registration, connection, ctx, mandate, purchase };
}

export function receipt(state: PurchaseReceipt["state"] = "COMPLETED", reference: string | null = null): PurchaseReceipt { return { externalId: "receipt", state, amountCents: 1500, merchantExternalId: "up-merchant", accountExternalId: "account", reference, responseId: "receipt" }; }
export function banking(create: BankingAdapter["createPurchase"], read: BankingAdapter["getPurchase"] = async () => receipt()): BankingAdapter {
  return { provider: "NESSIE", getAccount: async () => ({ externalId: "account", customerExternalId: "customer", label: "Fixture", currency: "USD", balanceCents: 10000, observedAt: Date.now(), responseId: null }), listCustomerAccounts: async () => [], listMerchants: async () => ({ merchants: [], supported: false }), listPurchases: async () => ({ purchases: [], definitive: false }), listBills: async () => ({ bills: [], supported: false }), listTransfers: async () => ({ transfers: [], supported: false }), createPurchase: create, getPurchase: read, findPurchaseByReference: async () => ({ supported: false }) };
}
