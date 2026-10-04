import type { DatabaseSync } from "node:sqlite";
import { conflict, forbidden, invalid } from "../contracts/errors";
import { atomic, num, row, rows, run, text } from "../storage/sql";
import { assertFreshAuth, assertOwner, audit, countActiveOwners, requireActiveMember, requireHuman, userLabel, rememberMutation, storeMutation, type HumanContext, type Role } from "./access";
import { canonicalHash, id, randomToken, sha256 } from "./ids";

export function listWorkspaces(db: DatabaseSync, userId: string) {
  return rows(
    db,
    `SELECT w.id, w.kind, w.label, w.timezone, m.role
     FROM workspaces w
     JOIN memberships m ON m.workspace_id = w.id
     WHERE m.user_id = ? AND m.state = 'ACTIVE' AND w.archived_at IS NULL
     ORDER BY w.created_at ASC`,
    [userId],
  ).map((item) => ({
    id: text(item.id),
    kind: text(item.kind),
    label: text(item.label),
    timezone: text(item.timezone),
    role: text(item.role),
  }));
}

export function createWorkspace(
  db: DatabaseSync,
  userId: string,
  input: { kind: "PERSONAL" | "BUSINESS"; label: string; timezone: string },
  now: number,
  requestKey?: string,
) {
  if (!["PERSONAL", "BUSINESS"].includes(input.kind)) throw invalid("WORKSPACE_KIND", "Choose personal or business.");
  assertTimezone(input.timezone);
  const label = input.label.trim();
  if (label.length < 1 || label.length > 80) throw invalid("INVALID_LABEL", "Workspace name must be 1 to 80 characters.");
  return atomic(db, () => {
    const bodyHash = canonicalHash(input);
    if (requestKey) {
      const existing = rememberMutation(db, { actorKind: "human", actorId: userId, action: "workspace", requestKey, bodyHash, at: now });
      if (existing.replay) return JSON.parse(existing.replay) as { id: string; kind: string; label: string; timezone: string; role: "owner" };
    }
    const workspaceId = id();
    run(
      db,
      "INSERT INTO workspaces (id, kind, label, timezone, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [workspaceId, input.kind, label, input.timezone, userId, now],
    );
    run(
      db,
      "INSERT INTO memberships (workspace_id, user_id, role, state, joined_at, version) VALUES (?, ?, 'owner', 'ACTIVE', ?, 1)",
      [workspaceId, userId, now],
    );
    audit(db, {
      workspaceId,
      actorKind: "human",
      actorUserId: userId,
      eventType: "WORKSPACE_CREATED",
      subjectType: "workspace",
      subjectId: workspaceId,
      detail: { kind: input.kind, label },
      at: now,
    });
    const result = { id: workspaceId, kind: input.kind, label, timezone: input.timezone, role: "owner" as const };
    if (requestKey) storeMutation(db, { workspaceId, actorKind: "human", actorId: userId, action: "workspace", requestKey, bodyHash, result, at: now });
    return result;
  });
}

export function listMembers(db: DatabaseSync, human: HumanContext) {
  const member = requireHuman(db, human);
  if (member.role === "member") throw forbidden("Members cannot review the organization roster.", "ROSTER_FORBIDDEN");
  return rows(
    db,
    "SELECT user_id, role, state, joined_at, version FROM memberships WHERE workspace_id = ? ORDER BY joined_at ASC",
    [human.workspaceId],
  ).map((item) => ({
    userId: text(item.user_id),
    name: userLabel(db, text(item.user_id)),
    role: text(item.role),
    state: text(item.state),
    joinedAt: num(item.joined_at),
    version: num(item.version),
  }));
}

export function createInvitation(
  db: DatabaseSync,
  human: HumanContext,
  role: Role,
  now: number,
  origin: string,
) {
  const member = requireHuman(db, human);
  assertOwner(member);
  const workspace = requireWorkspace(db, human.workspaceId);
  if (workspace.kind !== "BUSINESS") throw invalid("PERSONAL_WORKSPACE", "Personal workspaces do not accept invitations.");
  if (role !== "owner" && role !== "finance" && role !== "member") throw invalid("INVALID_ROLE", "Choose owner, finance, or member.");
  const token = randomToken("inv");
  const invitationId = id();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
  atomic(db, () => {
    assertOwner(requireHuman(db, human));
    if (role !== "member") assertFreshAuth(db, human.sessionId, human.userId, now);
    run(
      db,
      `INSERT INTO invitations (id, workspace_id, token_hash, invited_role, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [invitationId, human.workspaceId, sha256(token), role, human.userId, expiresAt],
    );
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "MEMBERSHIP_CHANGED",
      subjectType: "invitation",
      subjectId: invitationId,
      detail: { action: "invited", role },
      at: now,
    });
  });
  return {
    id: invitationId,
    role,
    expiresAt,
    url: `${origin}/invite/${token}`,
  };
}

export function acceptInvitation(db: DatabaseSync, userId: string, token: string, now: number) {
  const tokenHash = sha256(token);
  return atomic(db, () => {
    const invitation = row(db, "SELECT * FROM invitations WHERE token_hash = ?", [tokenHash]);
    if (!invitation || invitation.accepted_at) throw invalid("INVITATION_INVALID", "This invitation is no longer valid.");
    if (num(invitation.expires_at) <= now) throw invalid("INVITATION_EXPIRED", "This invitation has expired.");
    const workspaceId = text(invitation.workspace_id);
    const inviter = requireActiveMember(db, workspaceId, text(invitation.created_by));
    if (inviter.role !== "owner") throw invalid("INVITATION_INVALID", "The inviting owner's authority is no longer active.");
    const existing = row(db, "SELECT state FROM memberships WHERE workspace_id = ? AND user_id = ?", [workspaceId, userId]);
    if (existing && text(existing.state) === "ACTIVE") {
      throw invalid("ALREADY_MEMBER", "You already belong to this workspace.");
    }
    const role = text(invitation.invited_role);
    if (existing) {
      run(
        db,
        "UPDATE memberships SET role = ?, state = 'ACTIVE', joined_at = ?, version = version + 1 WHERE workspace_id = ? AND user_id = ?",
        [role, now, workspaceId, userId],
      );
    } else {
      run(
        db,
        "INSERT INTO memberships (workspace_id, user_id, role, state, joined_at, version) VALUES (?, ?, ?, 'ACTIVE', ?, 1)",
        [workspaceId, userId, role, now],
      );
    }
    run(db, "UPDATE invitations SET accepted_by = ?, accepted_at = ? WHERE id = ?", [userId, now, text(invitation.id)]);
    audit(db, {
      workspaceId,
      actorKind: "human",
      actorUserId: userId,
      eventType: "MEMBERSHIP_CHANGED",
      subjectType: "membership",
      subjectId: userId,
      detail: { action: "accepted", role },
      at: now,
    });
    return { workspaceId, role };
  });
}

export function updateMember(
  db: DatabaseSync,
  human: HumanContext,
  targetUserId: string,
  input: { role?: Role; state?: "ACTIVE" | "REMOVED"; expectedVersion: number },
  now: number,
) {
  return atomic(db, () => {
    const actor = requireHuman(db, human);
    assertOwner(actor);
    if (input.role && !["owner", "finance", "member"].includes(input.role)) throw invalid("INVALID_ROLE", "Choose owner, finance, or member.");
    if (input.state && !["ACTIVE", "REMOVED"].includes(input.state)) throw invalid("INVALID_MEMBER_STATE", "Choose an active or removed membership.");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw invalid("INVALID_VERSION", "A current membership version is required.");
    const target = row(
      db,
      "SELECT role, state, version FROM memberships WHERE workspace_id = ? AND user_id = ?",
      [human.workspaceId, targetUserId],
    );
    if (!target) throw invalid("MEMBER_MISSING", "That person is not in this workspace.");
    if (num(target.version) !== input.expectedVersion) {
      throw conflict("VERSION_CONFLICT", "The membership changed. Refresh and try again.");
    }
    const nextRole = input.role ?? (text(target.role) as Role);
    const nextState = input.state ?? text(target.state);
    const rank = { member: 0, finance: 1, owner: 2 };
    if ((nextState === "ACTIVE" && text(target.state) !== "ACTIVE") || rank[nextRole] > rank[text(target.role) as Role]) assertFreshAuth(db, human.sessionId, human.userId, now);
    if (text(target.role) === "owner" && text(target.state) === "ACTIVE" && (nextRole !== "owner" || nextState !== "ACTIVE")) {
      if (countActiveOwners(db, human.workspaceId) <= 1) {
        throw forbidden("The last owner cannot be removed.", "LAST_OWNER");
      }
    }
    const changes = run(
      db,
      "UPDATE memberships SET role = ?, state = ?, version = version + 1 WHERE workspace_id = ? AND user_id = ? AND version = ?",
      [nextRole, nextState, human.workspaceId, targetUserId, input.expectedVersion],
    );
    if (changes !== 1) throw conflict("VERSION_CONFLICT", "The membership changed. Refresh and try again.");
    if (nextState === "REMOVED") {
      run(
        db,
        `UPDATE connections SET state = 'REVOKED'
         WHERE workspace_id = ? AND user_id = ? AND state != 'REVOKED'`,
        [human.workspaceId, targetUserId],
      );
    }
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "MEMBERSHIP_CHANGED",
      subjectType: "membership",
      subjectId: targetUserId,
      detail: { role: nextRole, state: nextState },
      at: now,
    });
    return { userId: targetUserId, role: nextRole, state: nextState, version: input.expectedVersion + 1 };
  });
}

export function requireWorkspace(db: DatabaseSync, workspaceId: string) {
  const found = row(db, "SELECT id, kind, label, timezone, created_by, created_at, archived_at FROM workspaces WHERE id = ?", [workspaceId]);
  if (!found || found.archived_at) throw invalid("WORKSPACE_MISSING", "That workspace is not available.");
  return {
    id: text(found.id),
    kind: text(found.kind) as "PERSONAL" | "BUSINESS",
    label: text(found.label),
    timezone: text(found.timezone),
    createdBy: text(found.created_by),
    createdAt: num(found.created_at),
  };
}

export function assertTimezone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw invalid("INVALID_TIMEZONE", "Choose a valid IANA timezone, such as America/New_York.");
  }
}

export function mutationHash(value: unknown): string {
  return canonicalHash(value);
}

export function activeMemberOrNull(db: DatabaseSync, workspaceId: string, userId: string) {
  try {
    return requireActiveMember(db, workspaceId, userId);
  } catch {
    return null;
  }
}
