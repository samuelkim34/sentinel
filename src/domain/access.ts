import type { DatabaseSync } from "node:sqlite";
import { AppError, conflict, forbidden, notFound } from "../contracts/errors";
import { id } from "./ids";
import { num, row, run, text } from "../storage/sql";

export type Role = "owner" | "finance" | "member";

export type HumanContext = {
  kind: "human";
  userId: string;
  workspaceId: string;
  role: Role;
  sessionId: string;
};

export type ConnectorContext = {
  kind: "connector";
  userId: string;
  workspaceId: string;
  registrationId: string;
  connectionId: string;
  scopes: ReadonlySet<string>;
};

export type VoiceContext = {
  kind: "voice";
  userId: string;
  workspaceId: string;
  registrationId: string;
  voiceSessionId: string;
  scopes: ReadonlySet<string>;
};

export type WorkerContext = {
  kind: "worker";
  operationId: string;
};

export type Membership = {
  workspaceId: string;
  userId: string;
  role: Role;
  state: "ACTIVE" | "REMOVED";
  version: number;
};

export function loadMembership(db: DatabaseSync, workspaceId: string, userId: string): Membership | null {
  const found = row(
    db,
    "SELECT workspace_id, user_id, role, state, version FROM memberships WHERE workspace_id = ? AND user_id = ?",
    [workspaceId, userId],
  );
  if (!found) return null;
  return {
    workspaceId: text(found.workspace_id),
    userId: text(found.user_id),
    role: text(found.role) as Role,
    state: text(found.state) as "ACTIVE" | "REMOVED",
    version: num(found.version),
  };
}

export function requireActiveMember(db: DatabaseSync, workspaceId: string, userId: string): Membership {
  const member = loadMembership(db, workspaceId, userId);
  if (!member || member.state !== "ACTIVE") throw notFound();
  return member;
}

export function requireHuman(db: DatabaseSync, human: HumanContext): Membership {
  const member = requireActiveMember(db, human.workspaceId, human.userId);
  if (member.role !== human.role) {
    throw forbidden("Your workspace role changed. Refresh and try again.", "ROLE_CHANGED");
  }
  return member;
}

export function assertOwner(member: Membership): void {
  if (member.role !== "owner") throw forbidden("Only an owner can do that.", "OWNER_REQUIRED");
}

export function assertCanApprove(member: Membership): void {
  if (member.role !== "owner" && member.role !== "finance") {
    throw forbidden("You cannot approve purchases.", "APPROVAL_FORBIDDEN");
  }
}

export function audit(
  db: DatabaseSync,
  event: {
    workspaceId: string;
    actorKind: string;
    actorUserId?: string | null;
    connectionId?: string | null;
    eventType: string;
    subjectType: string;
    subjectId: string;
    detail: Record<string, unknown>;
    at: number;
  },
): void {
  run(
    db,
    `INSERT INTO audit_events (
      workspace_id, actor_kind, actor_user_id, connection_id, event_type, subject_type, subject_id, safe_detail_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.workspaceId,
      event.actorKind,
      event.actorUserId ?? null,
      event.connectionId ?? null,
      event.eventType,
      event.subjectType,
      event.subjectId,
      JSON.stringify(event.detail),
      event.at,
    ],
  );
}

export function rememberMutation(
  db: DatabaseSync,
  input: {
    workspaceId?: string | null;
    actorKind: string;
    actorId: string;
    action: string;
    requestKey: string;
    bodyHash: string;
    at: number;
  },
): { replay: string | null } {
  const existing = row(
    db,
    `SELECT body_hash, result_json FROM mutation_requests
     WHERE actor_kind = ? AND actor_id = ? AND action = ? AND request_key = ?`,
    [input.actorKind, input.actorId, input.action, input.requestKey],
  );
  if (!existing) return { replay: null };
  if (text(existing.body_hash) !== input.bodyHash) {
    throw conflict("IDEMPOTENCY_CONFLICT", "That idempotency key was already used for different terms.");
  }
  return { replay: text(existing.result_json) };
}

export function storeMutation(
  db: DatabaseSync,
  input: {
    workspaceId?: string | null;
    actorKind: string;
    actorId: string;
    action: string;
    requestKey: string;
    bodyHash: string;
    result: unknown;
    at: number;
  },
): void {
  run(
    db,
    `INSERT INTO mutation_requests (
      id, workspace_id, actor_kind, actor_id, action, request_key, body_hash, result_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id(),
      input.workspaceId ?? null,
      input.actorKind,
      input.actorId,
      input.action,
      input.requestKey,
      input.bodyHash,
      JSON.stringify(input.result),
      input.at,
    ],
  );
}

export function assertFreshAuth(db: DatabaseSync, sessionId: string, userId: string, now: number): void {
  const grant = row(db, "SELECT user_id, expires_at FROM reauth_grants WHERE session_id = ?", [sessionId]);
  if (!grant || text(grant.user_id) !== userId || num(grant.expires_at) <= now) {
    throw new AppError(401, "REAUTHENTICATION_REQUIRED", "Confirm your password before this financial change.");
  }
}

export function userLabel(db: DatabaseSync, userId: string): string {
  const table = row(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'");
  if (!table) return userId;
  const found = row(db, "SELECT name FROM user WHERE id = ?", [userId]);
  return found ? text(found.name) || userId : userId;
}

export function countActiveOwners(db: DatabaseSync, workspaceId: string): number {
  return num(
    row(
      db,
      "SELECT COUNT(*) AS c FROM memberships WHERE workspace_id = ? AND role = 'owner' AND state = 'ACTIVE'",
      [workspaceId],
    )?.c,
  );
}
