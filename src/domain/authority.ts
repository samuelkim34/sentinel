import type { DatabaseSync } from "node:sqlite";
import { CATEGORIES, CONNECTOR_SCOPES, type MerchantCategory } from "../contracts/constants";
import { conflict, forbidden, invalid } from "../contracts/errors";
import { parseUsdToCents } from "../contracts/money";
import { getEnv } from "../server/env";
import { atomic, num, row, rows, run, text } from "../storage/sql";
import { assertFreshAuth, assertOwner, audit, requireHuman, type HumanContext, type Role } from "./access";
import { canonicalHash, id, randomToken, sha256 } from "./ids";
import { requireWorkspace } from "./workspaces";

export type MandateInput = {
  registrationId: string;
  walletId: string;
  totalAllowance: unknown;
  perPurchaseLimit: unknown;
  reviewAbove: unknown;
  allowedCategories: MerchantCategory[];
  allowedMerchantIds: string[] | null;
  executionMode: "PROPOSE_ONLY" | "AUTO_WITHIN_LIMITS";
  expiresAt: number;
};

export function createRegistration(
  db: DatabaseSync,
  human: HumanContext,
  input: { name: string; purpose: string; walletIds: string[]; controllerUserId?: string },
  now: number,
) {
  return atomic(db, () => {
    const member = requireHuman(db, human);
    const controller = input.controllerUserId ?? human.userId;
    if (controller !== human.userId && member.role !== "owner") {
      throw forbidden("Only an owner can register a bot for another person.", "CONTROLLER_FORBIDDEN");
    }
    const controllerMember = row(
      db,
      "SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ? AND state = 'ACTIVE'",
      [human.workspaceId, controller],
    );
    if (!controllerMember) throw invalid("CONTROLLER_MISSING", "The controller must be an active member.");
    const workspace = requireWorkspace(db, human.workspaceId);
    if (member.role !== "owner" && workspace.kind === "BUSINESS" && input.walletIds.length > 0) {
      throw forbidden("An owner grants account access for a business bot.", "READ_GRANT_FORBIDDEN");
    }
    if (!input.name.trim() || input.name.trim().length > 80 || !input.purpose.trim() || input.purpose.trim().length > 500) throw invalid('INVALID_REGISTRATION', 'Use a name of 1–80 characters and a purpose of 1–500 characters.');
    input.walletIds = [...new Set(input.walletIds)];
    for (const walletId of input.walletIds) {
      const wallet = row(db, "SELECT id FROM wallets WHERE id = ? AND workspace_id = ?", [walletId, human.workspaceId]);
      if (!wallet) throw invalid("WALLET_MISSING", "Choose an account in this workspace.");
    }
    const registrationId = id();
    run(
      db,
      `INSERT INTO registrations (
        id, workspace_id, controller_user_id, name, purpose, state, created_by, version, created_at
      ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, 1, ?)`,
      [registrationId, human.workspaceId, controller, input.name.trim(), input.purpose.trim(), human.userId, now],
    );
    for (const walletId of input.walletIds) {
      run(
        db,
        "INSERT INTO read_grants (id, registration_id, wallet_id, granted_by, state) VALUES (?, ?, ?, ?, 'ACTIVE')",
        [id(), registrationId, walletId, human.userId],
      );
    }
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "REGISTRATION_CREATED",
      subjectType: "registration",
      subjectId: registrationId,
      detail: { name: input.name.trim(), controllerUserId: controller },
      at: now,
    });
    return registrationDetail(db, human, registrationId);
  });
}

export function listRegistrations(db: DatabaseSync, human: HumanContext) {
  requireHuman(db, human);
  const filter = human.role === "member" ? "AND controller_user_id = ?" : "";
  const params = human.role === "member" ? [human.workspaceId, human.userId] : [human.workspaceId];
  return rows(db, `SELECT id FROM registrations WHERE workspace_id = ? ${filter} ORDER BY created_at ASC`, params).map((item) =>
    registrationSummary(db, text(item.id)),
  );
}

export function getRegistration(db: DatabaseSync, human: HumanContext, registrationId: string) {
  requireHuman(db, human);
  return registrationDetail(db, human, registrationId);
}

export function updateRegistration(
  db: DatabaseSync,
  human: HumanContext,
  registrationId: string,
  input: { name?: string; purpose?: string; expectedVersion: number },
  now: number,
) {
  return atomic(db, () => {
    const registration = requireControllable(db, human, registrationId);
    if (num(registration.version) !== input.expectedVersion) throw conflict("VERSION_CONFLICT", "The registration changed. Refresh and try again.");
    const name = input.name?.trim() || text(registration.name);
    const purpose = input.purpose?.trim() || text(registration.purpose);
    if (name.length > 80 || purpose.length > 500) throw invalid("INVALID_REGISTRATION", "Use a name up to 80 and purpose up to 500 characters.");
    const changes = run(
      db,
      "UPDATE registrations SET name = ?, purpose = ?, version = version + 1 WHERE id = ? AND version = ?",
      [name, purpose, registrationId, input.expectedVersion],
    );
    if (changes !== 1) throw conflict("VERSION_CONFLICT", "The registration changed. Refresh and try again.");
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "REGISTRATION_UPDATED",
      subjectType: "registration",
      subjectId: registrationId,
      detail: { name, purpose },
      at: now,
    });
    return registrationDetail(db, human, registrationId);
  });
}

export function pauseRegistration(db: DatabaseSync, human: HumanContext, registrationId: string, now: number) {
  return atomic(db, () => {
    const member = requireHuman(db, human);
    const registration = row(db, "SELECT * FROM registrations WHERE id = ? AND workspace_id = ?", [registrationId, human.workspaceId]);
    if (!registration) throw invalid("REGISTRATION_MISSING", "That bot registration is not available.");
    const controller = text(registration.controller_user_id);
    const canPause = controller === human.userId || member.role === "owner" || member.role === "finance";
    if (!canPause) throw forbidden("You cannot pause this registration.", "PAUSE_FORBIDDEN");
    if (text(registration.state) === "ARCHIVED") throw conflict("REGISTRATION_ARCHIVED", "An archived registration cannot be paused.");
    run(db, "UPDATE registrations SET state = 'PAUSED', version = version + 1 WHERE id = ?", [registrationId]);
    cancelUnsubmitted(db, registrationId, "PAUSED", now, false);
    run(
      db,
      "UPDATE tasks SET state = 'PAUSED', updated_at = ?, version = version + 1 WHERE registration_id = ? AND state IN ('QUEUED','IN_PROGRESS')",
      [now, registrationId],
    );
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "WORK_CANCELLED",
      subjectType: "registration",
      subjectId: registrationId,
      detail: { action: "paused" },
      at: now,
    });
    return registrationDetail(db, human, registrationId);
  });
}

export function resumeRegistration(db: DatabaseSync, human: HumanContext, registrationId: string, now: number) {
  return atomic(db, () => {
    const registration = requireControllable(db, human, registrationId);
    if (text(registration.state) !== "PAUSED") throw conflict("NOT_PAUSED", "Only a paused registration can be resumed.");
    run(db, "UPDATE registrations SET state = 'ACTIVE', version = version + 1 WHERE id = ?", [registrationId]);
    // A cancelled proposal keeps its immutable revision. Resuming starts a new
    // revision only for paused tasks with no submitted operation.
    run(db, `UPDATE tasks SET revision = revision + 1 WHERE registration_id = ? AND state = 'PAUSED'
      AND EXISTS (SELECT 1 FROM proposals p WHERE p.task_id = tasks.id AND p.task_revision = tasks.revision AND p.state = 'CANCELLED')`, [registrationId]);
    run(
      db,
      "UPDATE tasks SET state = 'QUEUED', updated_at = ?, version = version + 1 WHERE registration_id = ? AND state = 'PAUSED'",
      [now, registrationId],
    );
    return registrationDetail(db, human, registrationId);
  });
}

export function archiveRegistration(db: DatabaseSync, human: HumanContext, registrationId: string, now: number) {
  return atomic(db, () => {
    requireControllable(db, human, registrationId);
    run(db, "UPDATE registrations SET state = 'ARCHIVED', version = version + 1 WHERE id = ?", [registrationId]);
    run(db, "UPDATE connections SET state = 'REVOKED' WHERE registration_id = ? AND state != 'REVOKED'", [registrationId]);
    run(db, "UPDATE voice_sessions SET state = 'ENDED', ended_at = ? WHERE registration_id = ? AND state = 'ACTIVE'", [now, registrationId]);
    cancelUnsubmitted(db, registrationId, "ARCHIVED", now, false);
    run(
      db,
      `UPDATE tasks SET state = 'CANCELLED', updated_at = ?, version = version + 1
       WHERE registration_id = ? AND state IN ('QUEUED','IN_PROGRESS','PAUSED','WAITING_APPROVAL','BLOCKED')`,
      [now, registrationId],
    );
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "WORK_CANCELLED",
      subjectType: "registration",
      subjectId: registrationId,
      detail: { action: "archived" },
      at: now,
    });
    return registrationDetail(db, human, registrationId);
  });
}

export function createConnection(db: DatabaseSync, human: HumanContext, registrationId: string, mode: "OAUTH" | "PERSONAL_TOKEN", now: number) {
  return atomic(db, () => {
    const registration = requireControllable(db, human, registrationId);
    if (text(registration.state) === "ARCHIVED") throw conflict("REGISTRATION_ARCHIVED", "Archived registrations cannot accept connections.");
    const workspace = requireWorkspace(db, human.workspaceId);
    if (mode === 'PERSONAL_TOKEN' && (workspace.kind !== 'PERSONAL' || text(registration.controller_user_id) !== human.userId)) {
      throw forbidden('Business bots must use the controller’s own OAuth sign-in. Personal tokens are limited to personal workspaces.', 'PERSONAL_TOKEN_FORBIDDEN');
    }
    const connectionId = id();
    const origin = getEnv().APP_ORIGIN.replace(/\/$/, "");
    const resourceUri = `${origin}/mcp/${connectionId}`;
    const scopes = connectorScopes(db, registrationId);
    let token: string | null = null;
    let tokenHash: string | null = null;
    if (mode === "PERSONAL_TOKEN") {
      token = randomToken("snt");
      tokenHash = sha256(token);
    }
    run(
      db,
      `INSERT INTO connections (
        id, workspace_id, registration_id, user_id, resource_uri, auth_mode, token_hash, state, scopes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      [connectionId, human.workspaceId, registrationId, text(registration.controller_user_id), resourceUri, mode, tokenHash, JSON.stringify(scopes), now],
    );
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "CONNECTION_AUTHORIZED",
      subjectType: "connection",
      subjectId: connectionId,
      detail: { authMode: mode, scopes },
      at: now,
    });
    return {
      id: connectionId,
      resourceUri,
      authMode: mode,
      scopes,
      token,
      note: mode === "PERSONAL_TOKEN"
        ? "This credential is shown once. It is a scoped compatibility token, not proof of which native Bot will use it."
        : "Use this exact resource URL in the native Grok Bot custom MCP connector.",
    };
  });
}

export function revokeConnection(db: DatabaseSync, human: HumanContext, connectionId: string, now: number) {
  return atomic(db, () => {
    requireHuman(db, human);
    const connection = row(db, "SELECT * FROM connections WHERE id = ? AND workspace_id = ?", [connectionId, human.workspaceId]);
    if (!connection) throw invalid("CONNECTION_MISSING", "That connection is not available.");
    const registration = row(db, "SELECT controller_user_id FROM registrations WHERE id = ?", [text(connection.registration_id)]);
    const controller = registration ? text(registration.controller_user_id) : "";
    if (controller !== human.userId && human.role !== "owner" && human.role !== "finance") {
      throw forbidden("You cannot revoke this connection.", "REVOKE_FORBIDDEN");
    }
    run(db, "UPDATE connections SET state = 'REVOKED' WHERE id = ?", [connectionId]);
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "CONNECTION_REVOKED",
      subjectType: "connection",
      subjectId: connectionId,
      detail: {},
      at: now,
    });
    return { id: connectionId, state: "REVOKED" };
  });
}

export function createMandate(db: DatabaseSync, human: HumanContext, input: MandateInput, now: number, requestKey?: string) {
  return atomic(db, () => {
    const member = requireHuman(db, human);
    assertOwner(member);
    assertFreshAuth(db, human.sessionId, human.userId, now);
    const bodyHash = canonicalHash(input);
    if (requestKey) {
      const existing = row(
        db,
        "SELECT body_hash, result_json FROM mutation_requests WHERE actor_kind = 'human' AND actor_id = ? AND action = 'mandate' AND request_key = ?",
        [human.userId, requestKey],
      );
      if (existing) {
        if (text(existing.body_hash) !== bodyHash) throw conflict("IDEMPOTENCY_CONFLICT", "That idempotency key was already used for different terms.");
        return JSON.parse(text(existing.result_json)) as ReturnType<typeof mandateDto>;
      }
    }
    const created = insertMandate(db, human, input, now);
    if (requestKey) {
      run(
        db,
        `INSERT INTO mutation_requests (id, workspace_id, actor_kind, actor_id, action, request_key, body_hash, result_json, created_at)
         VALUES (?, ?, 'human', ?, 'mandate', ?, ?, ?, ?)`,
        [id(), human.workspaceId, human.userId, requestKey, bodyHash, JSON.stringify(created), now],
      );
    }
    return created;
  });
}

export function revokeMandate(db: DatabaseSync, human: HumanContext, mandateId: string, now: number) {
  return atomic(db, () => {
    const member = requireHuman(db, human);
    assertOwner(member);
    const mandate = row(db, "SELECT * FROM mandates WHERE id = ? AND workspace_id = ?", [mandateId, human.workspaceId]);
    if (!mandate) throw invalid("MANDATE_MISSING", "That mandate is not available.");
    if (text(mandate.state) !== "ACTIVE") return mandateDto(mandate);
    run(db, "UPDATE mandates SET state = 'REVOKED' WHERE id = ?", [mandateId]);
    cancelMandateProposals(db, mandateId, now);
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "MANDATE_REVOKED",
      subjectType: "mandate",
      subjectId: mandateId,
      detail: {},
      at: now,
    });
    return mandateDto(row(db, "SELECT * FROM mandates WHERE id = ?", [mandateId])!);
  });
}

export function replaceMandate(db: DatabaseSync, human: HumanContext, mandateId: string, input: MandateInput, now: number) {
  return atomic(db, () => {
    const member = requireHuman(db, human);
    assertOwner(member);
    assertFreshAuth(db, human.sessionId, human.userId, now);
    const old = row(db, "SELECT * FROM mandates WHERE id = ? AND workspace_id = ? AND state = 'ACTIVE'", [mandateId, human.workspaceId]);
    if (!old) throw invalid("MANDATE_MISSING", "There is no active mandate to replace.");
    run(db, "UPDATE mandates SET state = 'REVOKED' WHERE id = ?", [mandateId]);
    cancelMandateProposals(db, mandateId, now);
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "MANDATE_REVOKED",
      subjectType: "mandate",
      subjectId: mandateId,
      detail: { replaced: true },
      at: now,
    });
    const created = insertMandate(db, human, input, now);
    return { revokedMandateId: mandateId, mandate: created, note: "This is a new lifetime allowance. Previous spending is not reset or edited." };
  });
}

export function listMandates(db: DatabaseSync, human: HumanContext) {
  requireHuman(db, human);
  const filter = human.role === "member" ? "AND controller_user_id = ?" : "";
  const params = human.role === "member" ? [human.workspaceId, human.userId] : [human.workspaceId];
  return rows(db, `SELECT * FROM mandates WHERE workspace_id = ? ${filter} ORDER BY created_at DESC`, params).map(mandateDto);
}

function insertMandate(db: DatabaseSync, human: HumanContext, input: MandateInput, now: number) {
  const registration = row(db, "SELECT * FROM registrations WHERE id = ? AND workspace_id = ?", [input.registrationId, human.workspaceId]);
  if (!registration || text(registration.state) === "ARCHIVED") throw invalid("REGISTRATION_MISSING", "Choose an active registration.");
  const wallet = row(db, "SELECT id FROM wallets WHERE id = ? AND workspace_id = ?", [input.walletId, human.workspaceId]);
  if (!wallet) throw invalid("WALLET_MISSING", "Choose an account in this workspace.");
  const active = row(
    db,
    "SELECT id FROM mandates WHERE registration_id = ? AND wallet_id = ? AND state = 'ACTIVE'",
    [input.registrationId, input.walletId],
  );
  if (active) throw conflict("MANDATE_EXISTS", "Revoke the current mandate before granting another allowance for this account.");
  const allowance = parseUsdToCents(input.totalAllowance);
  const perPurchase = parseUsdToCents(input.perPurchaseLimit);
  const reviewAbove = parseUsdToCents(input.reviewAbove);
  if (perPurchase <= 0) throw invalid("INVALID_AMOUNT", "The per-purchase cap must be positive.");
  if (!input.allowedCategories.length || input.allowedCategories.some((category) => !CATEGORIES.includes(category) || category === "UNKNOWN")) {
    throw invalid("INVALID_CATEGORY", "Choose at least one confirmed category.");
  }
    if (!Number.isSafeInteger(input.expiresAt) || !Number.isFinite(new Date(input.expiresAt).getTime()) || input.expiresAt <= now) throw invalid("MANDATE_EXPIRED", "Choose a valid mandate expiration in the future.");
  const grant = row(
    db,
    "SELECT id FROM read_grants WHERE registration_id = ? AND wallet_id = ? AND state = 'ACTIVE'",
    [input.registrationId, input.walletId],
  );
  if (!grant) {
    run(
      db,
      "INSERT INTO read_grants (id, registration_id, wallet_id, granted_by, state) VALUES (?, ?, ?, ?, 'ACTIVE')",
      [id(), input.registrationId, input.walletId, human.userId],
    );
  }
  const mandateId = id();
  run(
    db,
    `INSERT INTO mandates (
      id, workspace_id, registration_id, controller_user_id, wallet_id, currency, total_allowance_cents,
      per_purchase_limit_cents, review_above_cents, allowed_categories, allowed_merchant_ids, execution_mode,
      expires_at, created_by, state, created_at
    ) VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
    [
      mandateId,
      human.workspaceId,
      input.registrationId,
      text(registration.controller_user_id),
      input.walletId,
      allowance,
      perPurchase,
      reviewAbove,
      JSON.stringify(input.allowedCategories),
      input.allowedMerchantIds ? JSON.stringify(input.allowedMerchantIds) : null,
      input.executionMode,
      input.expiresAt,
      human.userId,
      now,
    ],
  );
  audit(db, {
    workspaceId: human.workspaceId,
    actorKind: "human",
    actorUserId: human.userId,
    eventType: "MANDATE_GRANTED",
    subjectType: "mandate",
    subjectId: mandateId,
    detail: {
      allowanceCents: allowance,
      perPurchaseLimitCents: perPurchase,
      reviewAboveCents: reviewAbove,
      executionMode: input.executionMode,
      newAllowance: true,
    },
    at: now,
  });
  return mandateDto(row(db, "SELECT * FROM mandates WHERE id = ?", [mandateId])!);
}

export function mandateDto(item: Record<string, unknown>) {
  return {
    id: text(item.id as never),
    workspaceId: text(item.workspace_id as never),
    registrationId: text(item.registration_id as never),
    controllerUserId: text(item.controller_user_id as never),
    walletId: text(item.wallet_id as never),
    currency: "USD" as const,
    totalAllowanceCents: num(item.total_allowance_cents as never),
    perPurchaseLimitCents: num(item.per_purchase_limit_cents as never),
    reviewAboveCents: num(item.review_above_cents as never),
    allowedCategories: JSON.parse(text(item.allowed_categories as never)) as string[],
    allowedMerchantIds: item.allowed_merchant_ids ? JSON.parse(text(item.allowed_merchant_ids as never)) as string[] : null,
    executionMode: text(item.execution_mode as never) as "PROPOSE_ONLY" | "AUTO_WITHIN_LIMITS",
    expiresAt: num(item.expires_at as never),
    createdByUserId: text(item.created_by as never),
    state: text(item.state as never),
    createdAt: num(item.created_at as never),
  };
}

function connectorScopes(db: DatabaseSync, registrationId: string): string[] {
  // Consent covers possible tool scopes; a current mandate is still required
  // when authenticating and when evaluating a purchase. Connecting before a
  // grant must not permanently remove proposal permission.
  void db; void registrationId;
  return [...CONNECTOR_SCOPES];
}

function requireControllable(db: DatabaseSync, human: HumanContext, registrationId: string) {
  const member = requireHuman(db, human);
  const registration = row(db, "SELECT * FROM registrations WHERE id = ? AND workspace_id = ?", [registrationId, human.workspaceId]);
  if (!registration) throw invalid("REGISTRATION_MISSING", "That bot registration is not available.");
  const controller = text(registration.controller_user_id);
  if (controller !== human.userId && member.role === "member") {
    throw forbidden("You can only change your own registration.", "REGISTRATION_FORBIDDEN");
  }
  if (controller !== human.userId && member.role === "finance") {
    throw forbidden("Finance can pause organization bots, not edit their profile.", "REGISTRATION_FORBIDDEN");
  }
  return registration;
}

function registrationSummary(db: DatabaseSync, registrationId: string) {
  const registration = row(db, "SELECT * FROM registrations WHERE id = ?", [registrationId])!;
  const connection = row(
    db,
    "SELECT tools_verified_at, last_seen_at, state FROM connections WHERE registration_id = ? AND state != 'REVOKED' ORDER BY created_at DESC LIMIT 1",
    [registrationId],
  );
  return {
    id: registrationId,
    name: text(registration.name),
    purpose: text(registration.purpose),
    controllerUserId: text(registration.controller_user_id),
    state: text(registration.state),
    version: num(registration.version),
    toolsVerifiedAt: connection?.tools_verified_at ? num(connection.tools_verified_at) : null,
    lastSeenAt: connection?.last_seen_at ? num(connection.last_seen_at) : null,
    connectionState: connection ? text(connection.state) : null,
  };
}

function registrationDetail(db: DatabaseSync, human: HumanContext, registrationId: string) {
  const registration = row(db, "SELECT * FROM registrations WHERE id = ? AND workspace_id = ?", [registrationId, human.workspaceId]);
  if (!registration) throw invalid("REGISTRATION_MISSING", "That bot registration is not available.");
  const summary = registrationSummary(db, registrationId);
  if (human.role === "member" && summary.controllerUserId !== human.userId) {
    throw invalid("REGISTRATION_MISSING", "That bot registration is not available.");
  }
  const grants = rows(
    db,
    "SELECT wallet_id, state FROM read_grants WHERE registration_id = ?",
    [registrationId],
  ).map((item) => ({ walletId: text(item.wallet_id), state: text(item.state) }));
  const mandates = rows(db, "SELECT * FROM mandates WHERE registration_id = ? ORDER BY created_at DESC", [registrationId]).map(mandateDto);
  const tasks = rows(
    db,
    "SELECT id, title, state, kind FROM tasks WHERE registration_id = ? ORDER BY created_at DESC LIMIT 20",
    [registrationId],
  ).map((item) => ({ id: text(item.id), title: text(item.title), state: text(item.state), kind: text(item.kind) }));
  const origin = safeOrigin();
  const connection = row(db, "SELECT id, resource_uri, auth_mode, state FROM connections WHERE registration_id = ? ORDER BY created_at DESC LIMIT 1", [registrationId]);
  return {
    ...summary,
    workspaceId: human.workspaceId,
    createdBy: text(registration.created_by),
    grants,
    mandates,
    tasks,
    setup: {
      registrationId,
      connectorUrl: connection ? text(connection.resource_uri) : `${origin}/mcp/<connection-id>`,
      connectionId: connection ? text(connection.id) : null,
      authMode: connection ? text(connection.auth_mode) : null,
      instructions: botInstructions(summary.name, summary.purpose, connection ? text(connection.resource_uri) : `${origin}/mcp/<connection-id>`),
    },
  };
}

function safeOrigin(): string {
  try {
    return getEnv().APP_ORIGIN.replace(/\/$/, "");
  } catch {
    return "http://127.0.0.1:43117";
  }
}

export function botInstructions(name: string, purpose: string, connectorUrl: string): string {
  return [
    `You are working through Sentinel as ${name}.`,
    `Purpose: ${purpose}`,
    "Sentinel is the authority for accounts, tasks, and purchases. Do not treat your private memory as a balance or an approval.",
    `Use the remote MCP server at ${connectorUrl}.`,
    "Call get_context before spending decisions. Claim work with get_next_task. Check queued instructions before the next proposal.",
    "submit_proposal records a request. It does not mean the purchase was paid.",
    "You cannot approve purchases, raise a budget, or call the bank directly.",
  ].join("\n");
}

export function cancelUnsubmitted(db: DatabaseSync, registrationId: string, reason: string, now: number, reservedOnly: boolean) {
  const states = reservedOnly ? "('RESERVED')" : "('RESERVED','REVIEW_REQUIRED')";
  const proposals = rows(db, `SELECT id FROM proposals WHERE registration_id = ? AND state IN ${states}`, [registrationId]);
  for (const proposal of proposals) {
    run(db, "DELETE FROM reservations WHERE proposal_id = ?", [text(proposal.id)]);
    run(db, "UPDATE proposals SET state = 'CANCELLED', cancel_reason = ?, updated_at = ? WHERE id = ?", [reason, now, text(proposal.id)]);
    run(db, "UPDATE jobs SET state = 'FAILED', error_code = ? WHERE subject_id = ? AND kind = 'payment' AND state = 'DUE'", [reason, text(proposal.id)]);
    run(db, `UPDATE tasks SET state = ?, updated_at = ?, version = version + 1
      WHERE id = (SELECT task_id FROM proposals WHERE id = ?)`, [reason === 'PAUSED' ? 'PAUSED' : 'CANCELLED', now, text(proposal.id)]);
    run(db, 'DELETE FROM task_leases WHERE task_id = (SELECT task_id FROM proposals WHERE id = ?)', [text(proposal.id)]);
  }
}

function cancelMandateProposals(db: DatabaseSync, mandateId: string, now: number) {
  const proposals = rows(db, "SELECT id FROM proposals WHERE mandate_id = ? AND state IN ('RESERVED','REVIEW_REQUIRED')", [mandateId]);
  for (const proposal of proposals) {
    run(db, "DELETE FROM reservations WHERE proposal_id = ?", [text(proposal.id)]);
    run(
      db,
      "UPDATE proposals SET state = 'CANCELLED', cancel_reason = 'MANDATE_REVOKED', updated_at = ? WHERE id = ?",
      [now, text(proposal.id)],
    );
    run(db, "UPDATE jobs SET state = 'FAILED', error_code = 'MANDATE_REVOKED' WHERE subject_id = ? AND kind = 'payment' AND state = 'DUE'", [text(proposal.id)]);
    run(db, "UPDATE tasks SET state = 'BLOCKED', updated_at = ?, version = version + 1 WHERE id = (SELECT task_id FROM proposals WHERE id = ?)", [now, text(proposal.id)]);
    run(db, 'DELETE FROM task_leases WHERE task_id = (SELECT task_id FROM proposals WHERE id = ?)', [text(proposal.id)]);
  }
}

export function canManageRole(role: Role): boolean {
  return role === "owner";
}
