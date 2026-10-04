import type { DatabaseSync } from "node:sqlite";
import { CATEGORIES, type MerchantCategory } from "../contracts/constants";
import { conflict, invalid, unavailable } from "../contracts/errors";
import { parseUsdToCents, sumCents } from "../contracts/money";
import { getBankingAdapter } from "../banking/adapter";
import { BankOperationError, type ProvisionInput } from "../banking/types";
import { atomic, num, row, rows, run, text } from "../storage/sql";
import { assertFreshAuth, assertOwner, audit, requireHuman, type HumanContext } from "./access";
import { id } from "./ids";
import { requireWorkspace } from "./workspaces";
import { getEnv } from "../server/env";
import { suggestedMerchantCategory } from "../banking/sandbox-merchant-catalog";

export async function provisionSandboxAccount(db: DatabaseSync, human: HumanContext, input: ProvisionInput, now: number) {
  const member = requireHuman(db, human);
  assertOwner(member);
  assertFreshAuth(db, human.sessionId, human.userId, now);
  const adapter = getBankingAdapter();
  if (!adapter.createSandboxCustomer) throw unavailable("BANK_UNAVAILABLE", "Sandbox account creation is not available.");
  let created: { customerId: string; account: { externalId: string; label: string; balanceCents: number; observedAt: number; responseId: string | null } };
  try {
    created = await adapter.createSandboxCustomer(input);
  } catch (error) {
    throw bankError(error);
  }
  return atomic(db, () => linkObservedAccount(db, human, {
    customerId: created.customerId,
    accountId: created.account.externalId,
    label: input.nickname.trim() || created.account.label,
    balanceCents: created.account.balanceCents,
    observedAt: created.account.observedAt,
    responseId: created.account.responseId,
    grantSource: "CREATED",
  }, now));
}

export async function linkPermittedAccount(
  db: DatabaseSync,
  human: HumanContext,
  input: { customerId: string; accountId: string },
  now: number,
) {
  const member = requireHuman(db, human);
  assertOwner(member);
  const permission = row(
    db,
    "SELECT id FROM bank_link_permissions WHERE workspace_id = ? AND allowed_customer_id = ?",
    [human.workspaceId, input.customerId],
  );
  if (!permission) throw invalid("LINK_NOT_PERMITTED", "This workspace has not been granted that sandbox customer.");
  const adapter = getBankingAdapter();
  let accounts;
  try {
    accounts = await adapter.listCustomerAccounts(input.customerId);
  } catch (error) {
    throw bankError(error);
  }
  const match = accounts.find((account) => account.externalId === input.accountId);
  if (!match || match.customerExternalId !== input.customerId) {
    throw invalid("ACCOUNT_NOT_OWNED", "That account is not part of the permitted sandbox customer.");
  }
  return atomic(db, () => linkObservedAccount(db, human, {
    customerId: input.customerId,
    accountId: match.externalId,
    label: match.label,
    balanceCents: match.balanceCents,
    observedAt: match.observedAt,
    responseId: match.responseId,
    grantSource: "OPERATOR",
  }, now));
}

function linkObservedAccount(
  db: DatabaseSync,
  human: HumanContext,
  input: {
    customerId: string;
    accountId: string;
    label: string;
    balanceCents: number;
    observedAt: number;
    responseId: string | null;
    grantSource: string;
  },
  now: number,
) {
  const member = requireHuman(db, human);
  assertOwner(member);
  if (input.grantSource === 'OPERATOR' && !row(db, 'SELECT id FROM bank_link_permissions WHERE workspace_id = ? AND allowed_customer_id = ?', [human.workspaceId, input.customerId])) {
    throw invalid('LINK_NOT_PERMITTED', 'That sandbox customer is no longer permitted.');
  }
  const existing = row(db, "SELECT id, workspace_id FROM wallets WHERE upstream_account_id = ?", [input.accountId]);
  if (existing) throw conflict("ACCOUNT_ALREADY_LINKED", "That sandbox account is already linked.");
  const unresolved = row(
    db,
    "SELECT id FROM payment_operations WHERE wallet_id IN (SELECT id FROM wallets WHERE upstream_account_id = ?) AND state IN ('SUBMITTING','SUBMITTED_PENDING','RECONCILE_REQUIRED')",
    [input.accountId],
  );
  if (unresolved) throw conflict("ACCOUNT_IN_FLIGHT", "That account still has an unresolved Sentinel operation.");
  const integration = row(
    db,
    "SELECT id FROM bank_integrations WHERE workspace_id = ? AND customer_id = ?",
    [human.workspaceId, input.customerId],
  );
  const integrationId = integration ? text(integration.id) : id();
  if (!integration) {
    run(
      db,
      `INSERT INTO bank_integrations (
        id, workspace_id, provider, credential_source, customer_id, configuration_state, last_verified_at
      ) VALUES (?, ?, 'NESSIE', 'ENV', ?, 'LINKED', ?)`,
      [integrationId, human.workspaceId, input.customerId, now],
    );
  }
  if (input.grantSource === "CREATED") {
    const already = row(
      db,
      "SELECT id FROM bank_link_permissions WHERE workspace_id = ? AND allowed_customer_id = ?",
      [human.workspaceId, input.customerId],
    );
    if (!already) {
      run(
        db,
        "INSERT INTO bank_link_permissions (id, workspace_id, allowed_customer_id, grant_source, created_at) VALUES (?, ?, ?, 'CREATED', ?)",
        [id(), human.workspaceId, input.customerId, now],
      );
    }
  }
  const walletId = id();
  run(
    db,
    `INSERT INTO wallets (
      id, workspace_id, integration_id, upstream_account_id, upstream_customer_id, label, currency,
      policy_balance_cents, state, last_verified_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, 'USD', ?, 'ACTIVE', ?, 1)`,
    [walletId, human.workspaceId, integrationId, input.accountId, input.customerId, input.label, input.balanceCents, input.observedAt],
  );
  run(
    db,
    `INSERT INTO bank_observations (
      id, wallet_id, observed_balance_cents, observed_at, source, response_id, validation_state
    ) VALUES (?, ?, ?, ?, 'NESSIE', ?, 'VALID')`,
    [id(), walletId, input.balanceCents, input.observedAt, input.responseId],
  );
  audit(db, {
    workspaceId: human.workspaceId,
    actorKind: "human",
    actorUserId: human.userId,
    eventType: "ACCOUNT_LINKED",
    subjectType: "wallet",
    subjectId: walletId,
    detail: { provider: "Nessie sandbox", customerId: input.customerId },
    at: now,
  });
  return { id: walletId, label: input.label, policyBalanceCents: input.balanceCents };
}

export function grantLinkPermission(db: DatabaseSync, workspaceId: string, customerId: string, now: number) {
  requireWorkspace(db, workspaceId);
  const existing = row(
    db,
    "SELECT id FROM bank_link_permissions WHERE workspace_id = ? AND allowed_customer_id = ?",
    [workspaceId, customerId],
  );
  if (existing) return { id: text(existing.id), created: false };
  const permissionId = id();
  run(
    db,
    "INSERT INTO bank_link_permissions (id, workspace_id, allowed_customer_id, grant_source, created_at) VALUES (?, ?, ?, 'OPERATOR', ?)",
    [permissionId, workspaceId, customerId, now],
  );
  return { id: permissionId, created: true };
}

export async function listLinkCandidates(db: DatabaseSync, human: HumanContext) {
  assertOwner(requireHuman(db, human));
  const permissions = rows(
    db,
    "SELECT allowed_customer_id, grant_source FROM bank_link_permissions WHERE workspace_id = ? ORDER BY created_at ASC",
    [human.workspaceId],
  );
  const linked = rows(
    db,
    "SELECT upstream_customer_id, upstream_account_id, label FROM wallets WHERE workspace_id = ?",
    [human.workspaceId],
  );
  const adapter = getBankingAdapter();
  const customers = [];
  for (const permission of permissions) {
    const customerId = text(permission.allowed_customer_id);
    let accounts: Array<{ externalId: string; label: string; balanceCents: number }> = [];
    let error: string | null = null;
    try {
      accounts = (await adapter.listCustomerAccounts(customerId)).map((account) => ({
        externalId: account.externalId,
        label: account.label,
        balanceCents: account.balanceCents,
      }));
    } catch (cause) {
      error = cause instanceof BankOperationError ? cause.message : "Account list failed.";
    }
    customers.push({ customerId, grantSource: text(permission.grant_source), accounts, error });
  }
  return {
    customers,
    linked: linked.map((item) => ({
      customerId: text(item.upstream_customer_id),
      accountId: text(item.upstream_account_id),
      label: text(item.label),
    })),
  };
}

export function listWallets(db: DatabaseSync, human: HumanContext) {
  const member = requireHuman(db, human);
  const visible = walletRows(db, human.workspaceId, member.role === "member" ? member.userId : null);
  return visible.map((wallet) => walletSummary(db, wallet));
}

export function getWallet(db: DatabaseSync, human: HumanContext, walletId: string) {
  const member = requireHuman(db, human);
  const wallet = requireVisibleWallet(db, human.workspaceId, walletId, member.role === "member" ? member.userId : null);
  const protections = rows(
    db,
    "SELECT id, label, amount_cents, state, version FROM protections WHERE workspace_id = ? AND wallet_id = ? ORDER BY label",
    [human.workspaceId, walletId],
  ).map((item) => ({
    id: text(item.id),
    label: text(item.label),
    amountCents: num(item.amount_cents),
    state: text(item.state),
    version: num(item.version),
  }));
  const observations = rows(
    db,
    "SELECT observed_balance_cents, observed_at, validation_state FROM bank_observations WHERE wallet_id = ? ORDER BY observed_at DESC LIMIT 8",
    [walletId],
  ).map((item) => ({
    balanceCents: num(item.observed_balance_cents),
    observedAt: num(item.observed_at),
    validationState: text(item.validation_state),
  }));
  const reservations = reservationTotal(db, walletId);
  const operations = rows(
    db,
    `SELECT p.id, p.state, p.amount_cents, o.upstream_id, o.upstream_reference, o.state AS op_state
     FROM proposals p LEFT JOIN payment_operations o ON o.proposal_id = p.id
     WHERE p.wallet_id = ? AND p.workspace_id = ? ${member.role === "member" ? "AND p.requester_user_id = ?" : ""} AND p.state IN ('RESERVED','SUBMITTING','SUBMITTED_PENDING','RECONCILE_REQUIRED','COMPLETED','FAILED')
     ORDER BY p.created_at DESC LIMIT 20`,
    member.role === "member" ? [walletId, human.workspaceId, human.userId] : [walletId, human.workspaceId],
  ).map((item) => ({
    proposalId: text(item.id),
    proposalState: text(item.state),
    amountCents: num(item.amount_cents),
    upstreamId: item.upstream_id ? text(item.upstream_id) : null,
    reference: item.upstream_reference ? text(item.upstream_reference) : null,
    operationState: item.op_state ? text(item.op_state) : null,
  }));
  const summary = walletSummary(db, wallet);
  return { ...summary, protections, observations, reservationsCents: reservations, operations };
}

export async function refreshWallet(db: DatabaseSync, human: HumanContext, walletId: string, now: number) {
  requireHuman(db, human);
  const wallet = requireVisibleWallet(db, human.workspaceId, walletId, null);
  if (human.role === "member") requireVisibleWallet(db, human.workspaceId, walletId, human.userId);
  const adapter = getBankingAdapter();
  let account;
  try {
    account = await adapter.getAccount(text(wallet.upstream_account_id));
  } catch (error) {
    throw bankError(error);
  }
  return atomic(db, () => {
    const member = requireHuman(db, human);
    const current = requireVisibleWallet(db, human.workspaceId, walletId, member.role === 'member' ? human.userId : null);
    if (num(current.version) !== num(wallet.version)) throw conflict('WALLET_VERSION', 'The account changed during refresh. Read it again.');
    if (account.externalId !== text(current.upstream_account_id) || account.customerExternalId !== text(current.upstream_customer_id)) {
      throw invalid('ACCOUNT_MISMATCH', 'The bank returned a different account.');
    }
    return applyObservation(db, human.workspaceId, walletId, account.balanceCents, account.observedAt || now, account.responseId, human.userId);
  });
}

export function createProtection(
  db: DatabaseSync,
  human: HumanContext,
  input: { walletId: string; label: string; amount: unknown },
  now: number,
) {
  return atomic(db, () => {
    const member = requireHuman(db, human);
    assertOwner(member);
    assertFreshAuth(db, human.sessionId, human.userId, now);
    const amountCents = parseUsdToCents(input.amount);
    if (!input.label.trim() || input.label.trim().length > 80) throw invalid("INVALID_LABEL", "A protection label must be 1 to 80 characters.");
    const wallet = requireVisibleWallet(db, human.workspaceId, input.walletId, null);
    assertProtectionFits(db, wallet, amountCents, null);
    const protectionId = id();
    run(
      db,
      `INSERT INTO protections (id, workspace_id, wallet_id, label, amount_cents, state, created_by, version)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, 1)`,
      [protectionId, human.workspaceId, input.walletId, input.label.trim(), amountCents, human.userId],
    );
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "PROTECTION_CHANGED",
      subjectType: "protection",
      subjectId: protectionId,
      detail: { amountCents, label: input.label.trim(), state: "ACTIVE" },
      at: now,
    });
    return { id: protectionId, amountCents, version: 1, shortfallCents: shortfall(db, wallet, amountCents, protectionId) };
  });
}

export function updateProtection(
  db: DatabaseSync,
  human: HumanContext,
  protectionId: string,
  input: { amount?: unknown; state?: "ACTIVE" | "DISABLED"; expectedVersion: number },
  now: number,
) {
  return atomic(db, () => {
    const member = requireHuman(db, human);
    assertOwner(member);
    assertFreshAuth(db, human.sessionId, human.userId, now);
    const current = row(
      db,
      "SELECT * FROM protections WHERE id = ? AND workspace_id = ?",
      [protectionId, human.workspaceId],
    );
    if (!current) throw invalid("PROTECTION_MISSING", "That protection is not in this workspace.");
    if (num(current.version) !== input.expectedVersion) throw conflict("VERSION_CONFLICT", "The protection changed. Refresh and try again.");
    const wallet = requireVisibleWallet(db, human.workspaceId, text(current.wallet_id), null);
    const nextAmount = input.amount === undefined ? num(current.amount_cents) : parseUsdToCents(input.amount);
    const nextState = input.state ?? (text(current.state) as "ACTIVE" | "DISABLED");
    if (nextState !== 'ACTIVE' && nextState !== 'DISABLED') throw invalid('INVALID_STATE', 'Choose active or disabled.');
    if (nextState === "ACTIVE" && (text(current.state) !== 'ACTIVE' || nextAmount > num(current.amount_cents))) {
      assertProtectionFits(db, wallet, nextAmount, protectionId);
    }
    const changes = run(
      db,
      "UPDATE protections SET amount_cents = ?, state = ?, version = version + 1 WHERE id = ? AND version = ?",
      [nextAmount, nextState, protectionId, input.expectedVersion],
    );
    if (changes !== 1) throw conflict("VERSION_CONFLICT", "The protection changed. Refresh and try again.");
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "PROTECTION_CHANGED",
      subjectType: "protection",
      subjectId: protectionId,
      detail: { amountCents: nextAmount, state: nextState },
      at: now,
    });
    return { id: protectionId, amountCents: nextAmount, state: nextState, version: input.expectedVersion + 1 };
  });
}

export async function syncMerchants(db: DatabaseSync, human: HumanContext, now: number, prepareSandbox = false) {
  const member = requireHuman(db, human);
  assertOwner(member);
  const adapter = getBankingAdapter();
  let page;
  let setup: { created: number; renamed: number; existing: number } | null = null;
  try {
    if (prepareSandbox) {
      if (!adapter.prepareSandboxMerchants) throw unavailable("MERCHANT_SETUP_UNAVAILABLE", "Sandbox merchant setup is unavailable. Set NESSIE_API_KEY on the server and restart Sentinel.");
      setup = await adapter.prepareSandboxMerchants();
    }
    page = await adapter.listMerchants({ limit: 1000 });
  }
  catch (error) {
    if (error instanceof BankOperationError) throw unavailable(`MERCHANT_SYNC_${error.kind}`, `Merchant sync failed: ${error.message} Check the server's Nessie key and base URL.`);
    throw error;
  }
  if (!page.supported) throw unavailable("MERCHANT_SYNC_UNAVAILABLE", "Merchant listing is unavailable. Set NESSIE_API_KEY on the server and restart Sentinel.");
  return atomic(db, () => {
    assertOwner(requireHuman(db, human));
    for (const merchant of page.merchants) {
      const existing = row(db, "SELECT id, verified_category FROM merchant_catalog WHERE upstream_merchant_id = ?", [merchant.externalId]);
      if (existing) {
        run(
          db,
          "UPDATE merchant_catalog SET label = ?, raw_category = ?, last_synced_at = ? WHERE id = ?",
          [merchant.label, merchant.rawCategory, now, text(existing.id)],
        );
      } else {
        run(
          db,
          `INSERT INTO merchant_catalog (id, upstream_merchant_id, label, raw_category, verified_category, last_synced_at)
           VALUES (?, ?, ?, ?, 'UNKNOWN', ?)`,
          [id(), merchant.externalId, merchant.label, merchant.rawCategory, now],
        );
      }
    }
    if (setup) audit(db, { workspaceId: human.workspaceId, actorKind: "human", actorUserId: human.userId,
      eventType: "SANDBOX_MERCHANTS_PREPARED", subjectType: "workspace", subjectId: human.workspaceId,
      detail: setup, at: now });
    return { imported: page.merchants.length, setup };
  });
}

export function confirmMerchantCategory(
  db: DatabaseSync,
  human: HumanContext,
  merchantId: string,
  category: MerchantCategory,
  now: number,
) {
  return atomic(db, () => {
    const member = requireHuman(db, human);
    assertOwner(member);
    if (!CATEGORIES.includes(category) || category === "UNKNOWN") {
      throw invalid("INVALID_CATEGORY", "Choose a confirmed spending category.");
    }
    const merchant = row(db, "SELECT id FROM merchant_catalog WHERE id = ?", [merchantId]);
    if (!merchant) throw invalid("MERCHANT_MISSING", "That merchant is not in the catalog.");
    run(
      db,
      `INSERT INTO merchant_permissions (workspace_id, merchant_id, verification_state, verified_category, set_by, updated_at)
       VALUES (?, ?, 'CONFIRMED', ?, ?, ?)
       ON CONFLICT(workspace_id, merchant_id) DO UPDATE SET
         verification_state = 'CONFIRMED', verified_category = excluded.verified_category, set_by = excluded.set_by, updated_at = excluded.updated_at`,
      [human.workspaceId, merchantId, category, human.userId, now],
    );
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "MERCHANT_CATEGORY_CONFIRMED",
      subjectType: "merchant",
      subjectId: merchantId,
      detail: { category },
      at: now,
    });
    return { merchantId, category };
  });
}

export function listMerchants(db: DatabaseSync, human: HumanContext, search?: string) {
  requireHuman(db, human);
  const items = rows(db, "SELECT * FROM merchant_catalog ORDER BY label ASC LIMIT 1000");
  return items
    .map((item) => ({
      id: text(item.id),
      label: text(item.label),
      rawCategory: text(item.raw_category),
      suggestedCategory: suggestedMerchantCategory(text(item.label)),
      verifiedCategory: effectiveCategory(db, human.workspaceId, text(item.id), text(item.verified_category)),
    }))
    .filter((item) => !search || item.label.toLowerCase().includes(search.toLowerCase()));
}

// Confirm only the exact suggestions reviewed in the browser. Preserve any
// category another owner has confirmed since the page was loaded.
export function confirmSuggestedMerchantCategories(db: DatabaseSync, human: HumanContext, input: unknown, now: number) {
  return atomic(db, () => {
    assertOwner(requireHuman(db, human));
    if (!Array.isArray(input) || input.length < 1 || input.length > 1000) throw invalid("INVALID_SUGGESTIONS", "Choose between 1 and 1000 merchant suggestions.");
    const seen = new Set<string>();
    const selected = input.map(value => {
      if (!value || typeof value !== "object" || typeof value.id !== "string" || typeof value.category !== "string" || seen.has(value.id)) {
        throw invalid("INVALID_SUGGESTIONS", "Each suggestion needs a unique merchant and category.");
      }
      seen.add(value.id);
      const merchant = row(db, "SELECT id, label, verified_category FROM merchant_catalog WHERE id = ?", [value.id]);
      if (!merchant || suggestedMerchantCategory(text(merchant.label)) !== value.category) {
        throw conflict("SUGGESTIONS_CHANGED", "Merchant suggestions changed. Refresh and review them again.");
      }
      return { id: value.id, category: value.category as MerchantCategory, fallback: text(merchant.verified_category) };
    });
    let confirmed = 0;
    for (const merchant of selected) {
      if (effectiveCategory(db, human.workspaceId, merchant.id, merchant.fallback) !== "UNKNOWN") continue;
      confirmMerchantCategory(db, human, merchant.id, merchant.category, now);
      confirmed++;
    }
    return { confirmed, skipped: selected.length - confirmed };
  });
}

export function effectiveCategory(db: DatabaseSync, workspaceId: string, merchantId: string, fallback: string): MerchantCategory {
  const permission = row(
    db,
    "SELECT verified_category FROM merchant_permissions WHERE workspace_id = ? AND merchant_id = ? AND verification_state = 'CONFIRMED'",
    [workspaceId, merchantId],
  );
  const value = permission?.verified_category ? text(permission.verified_category) : fallback;
  return (CATEGORIES.includes(value as MerchantCategory) ? value : "UNKNOWN") as MerchantCategory;
}

function walletRows(db: DatabaseSync, workspaceId: string, memberUserId: string | null) {
  if (!memberUserId) return rows(db, "SELECT * FROM wallets WHERE workspace_id = ? ORDER BY label", [workspaceId]);
  return rows(
    db,
    `SELECT DISTINCT w.* FROM wallets w
     JOIN read_grants g ON g.wallet_id = w.id AND g.state = 'ACTIVE'
     JOIN registrations r ON r.id = g.registration_id
     WHERE w.workspace_id = ? AND r.controller_user_id = ?
     ORDER BY w.label`,
    [workspaceId, memberUserId],
  );
}

function requireVisibleWallet(db: DatabaseSync, workspaceId: string, walletId: string, memberUserId: string | null) {
  const wallets = walletRows(db, workspaceId, memberUserId);
  const wallet = wallets.find((item) => text(item.id) === walletId);
  if (!wallet) throw invalid("WALLET_MISSING", "That account is not available.");
  return wallet;
}

export function walletSummary(db: DatabaseSync, wallet: Record<string, unknown>) {
  const walletId = text(wallet.id as never);
  const protectedCents = sumCents(
    rows(db, "SELECT amount_cents FROM protections WHERE wallet_id = ? AND state = 'ACTIVE'", [walletId]).map((item) => num(item.amount_cents)),
  );
  const reservedCents = reservationTotal(db, walletId);
  const balance = num(wallet.policy_balance_cents as never);
  const latest = row(db, "SELECT observed_balance_cents, observed_at FROM bank_observations WHERE wallet_id = ? ORDER BY observed_at DESC LIMIT 1", [walletId]);
  return {
    id: walletId,
    label: text(wallet.label as never),
    provider: "Nessie sandbox" as const,
    upstreamAccountId: maskAccount(text(wallet.upstream_account_id as never)),
    currency: "USD" as const,
    localSandboxLedger: Boolean(row(db, "SELECT wallet_id FROM sandbox_ledgers WHERE wallet_id = ?", [walletId])),
    policyBalanceCents: balance,
    observedBalanceCents: latest ? num(latest.observed_balance_cents) : null,
    observedAt: latest ? num(latest.observed_at) : null,
    protectedCents,
    reservedCents,
    spendableCents: Math.max(0, balance - protectedCents - reservedCents),
    state: text(wallet.state as never),
    quarantineReason: wallet.quarantine_reason ? text(wallet.quarantine_reason as never) : null,
    lastVerifiedAt: num(wallet.last_verified_at as never),
    version: num(wallet.version as never),
  };
}

function reservationTotal(db: DatabaseSync, walletId: string): number {
  return sumCents(rows(db, "SELECT amount_cents FROM reservations WHERE wallet_id = ?", [walletId]).map((item) => num(item.amount_cents)));
}

function assertProtectionFits(
  db: DatabaseSync,
  wallet: Record<string, unknown>,
  nextAmount: number,
  replacingId: string | null,
) {
  const others = rows(
    db,
    "SELECT id, amount_cents FROM protections WHERE wallet_id = ? AND state = 'ACTIVE'",
    [text(wallet.id as never)],
  ).filter((item) => text(item.id) !== replacingId);
  const floor = sumCents(others.map((item) => num(item.amount_cents))) + nextAmount;
  const reserved = reservationTotal(db, text(wallet.id as never));
  if (reserved > 0 && num(wallet.policy_balance_cents as never) - floor < reserved) {
    throw conflict("PROTECTION_CONFLICT", "That protection would undercut funds already reserved.", {
      reservedCents: reserved,
      policyBalanceCents: num(wallet.policy_balance_cents as never),
    });
  }
}

function shortfall(db: DatabaseSync, wallet: Record<string, unknown>, added: number, replacingId: string | null): number {
  const others = rows(db, "SELECT id, amount_cents FROM protections WHERE wallet_id = ? AND state = 'ACTIVE'", [text(wallet.id as never)])
    .filter((item) => text(item.id) !== replacingId);
  const floor = sumCents(others.map((item) => num(item.amount_cents))) + added;
  return Math.max(0, floor - num(wallet.policy_balance_cents as never));
}

export function applyObservation(
  db: DatabaseSync,
  workspaceId: string,
  walletId: string,
  balanceCents: number,
  observedAt: number,
  responseId: string | null,
  actorUserId: string | null,
) {
  const current = row(db, "SELECT * FROM wallets WHERE id = ? AND workspace_id = ?", [walletId, workspaceId]);
  if (!current) throw invalid("WALLET_MISSING", "That account is not available.");
  run(
    db,
    `INSERT INTO bank_observations (id, wallet_id, observed_balance_cents, observed_at, source, response_id, validation_state)
     VALUES (?, ?, ?, ?, 'NESSIE', ?, 'VALID')`,
    [id(), walletId, balanceCents, observedAt, responseId],
  );
  const unresolved = num(
    row(
      db,
      "SELECT COUNT(*) AS c FROM payment_operations WHERE wallet_id = ? AND state IN ('SUBMITTING','SUBMITTED_PENDING','RECONCILE_REQUIRED')",
      [walletId],
    )?.c,
  );
  let state = text(current.state);
  let reason = current.quarantine_reason ? text(current.quarantine_reason) : null;
  const sandboxLedger = row(db, 'SELECT initial_observed_cents FROM sandbox_ledgers WHERE wallet_id = ?', [walletId]);
  if (sandboxLedger && balanceCents !== num(sandboxLedger.initial_observed_cents)) {
    state = 'QUARANTINED';
    reason = 'Nessie balance changed after the local sandbox ledger began. Local spending has not been deducted again or reset. Reconcile the external change before further spending.';
  } else if (!sandboxLedger && unresolved === 0 && balanceCents !== num(current.policy_balance_cents)) {
    state = "QUARANTINED";
    reason = "Upstream balance does not match Sentinel's conservative balance.";
  }
  run(
    db,
    "UPDATE wallets SET last_verified_at = ?, state = ?, quarantine_reason = ?, version = version + 1 WHERE id = ? AND version = ?",
    [observedAt, state, reason, walletId, num(current.version)],
  );
  audit(db, {
    workspaceId,
    actorKind: actorUserId ? "human" : "worker",
    actorUserId,
    eventType: "BANK_OBSERVED",
    subjectType: "wallet",
    subjectId: walletId,
    detail: { observedBalanceCents: balanceCents, quarantined: state === "QUARANTINED" },
    at: observedAt,
  });
  const updated = row(db, "SELECT * FROM wallets WHERE id = ?", [walletId]);
  return walletSummary(db, updated!);
}

export function establishBaseline(db: DatabaseSync, human: HumanContext, walletId: string, now: number) {
  return atomic(db, () => {
    const member = requireHuman(db, human);
    assertOwner(member);
    assertFreshAuth(db, human.sessionId, human.userId, now);
    const wallet = row(db, "SELECT * FROM wallets WHERE id = ? AND workspace_id = ?", [walletId, human.workspaceId]);
    if (!wallet) throw invalid("WALLET_MISSING", "That account is not available.");
    if (row(db, 'SELECT wallet_id FROM sandbox_ledgers WHERE wallet_id = ?', [walletId])) throw conflict('SANDBOX_LEDGER_BASELINE', 'A local sandbox ledger cannot be reset from Nessie: that would restore already-spent funds. Use a new sandbox account for a fresh demo.');
    const unresolved = num(
      row(
        db,
        "SELECT COUNT(*) AS c FROM payment_operations WHERE wallet_id = ? AND state IN ('SUBMITTING','SUBMITTED_PENDING','RECONCILE_REQUIRED')",
        [walletId],
      )?.c,
    );
    if (unresolved > 0) throw conflict("RECONCILIATION_REQUIRED", "Resolve submitted operations before setting a new baseline.");
    const latest = row(db, "SELECT observed_balance_cents, observed_at FROM bank_observations WHERE wallet_id = ? ORDER BY observed_at DESC LIMIT 1", [walletId]);
    if (!latest) throw invalid("OBSERVATION_MISSING", "Refresh the account before setting a baseline.");
    if (now - num(latest.observed_at) > getBankingFreshnessMs()) throw conflict('BANK_STATE_STALE', 'Refresh the account before setting a baseline.');
    run(
      db,
      "UPDATE wallets SET policy_balance_cents = ?, state = 'ACTIVE', quarantine_reason = NULL, last_verified_at = ?, version = version + 1 WHERE id = ?",
      [num(latest.observed_balance_cents), num(latest.observed_at), walletId],
    );
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "BANK_OBSERVED",
      subjectType: "wallet",
      subjectId: walletId,
      detail: { baselineCents: num(latest.observed_balance_cents) },
      at: now,
    });
    return walletSummary(db, row(db, "SELECT * FROM wallets WHERE id = ?", [walletId])!);
  });
}

function getBankingFreshnessMs(): number {
  return getEnv().BANK_FRESHNESS_SECONDS * 1000;
}

function maskAccount(value: string): string {
  if (value.length <= 4) return value;
  return `••••${value.slice(-4)}`;
}

function bankError(error: unknown): Error {
  if (error instanceof BankOperationError) {
    if (error.kind === "UNCONFIGURED") return unavailable("NESSIE_NOT_CONFIGURED", error.message);
    if (error.kind === "TIMEOUT" || error.kind === "UNAVAILABLE") return unavailable("BANK_UNAVAILABLE", error.message);
    return invalid("BANK_REJECTED", error.message);
  }
  return unavailable("BANK_UNAVAILABLE", "The banking service did not return a usable result.");
}

export function insertMerchantForTests(db: DatabaseSync, input: { label: string; category?: MerchantCategory; upstreamId?: string }, now: number) {
  const merchantId = id();
  run(
    db,
    `INSERT INTO merchant_catalog (id, upstream_merchant_id, label, raw_category, verified_category, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [merchantId, input.upstreamId ?? merchantId, input.label, input.category ?? "OTHER", input.category ?? "UNKNOWN", now],
  );
  return merchantId;
}
