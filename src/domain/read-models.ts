import type { DatabaseSync } from "node:sqlite";
import { num, row, rows, text, type SqlRow } from "../storage/sql";
import { requireHuman, type HumanContext } from "./access";
import { listWallets } from "./accounts";
import { listRegistrations } from "./authority";

export function overview(db: DatabaseSync, human: HumanContext) {
  const member = requireHuman(db, human);
  const wallets = listWallets(db, human);
  const registrations = listRegistrations(db, human);
  const taskCounts = countBy(db, "tasks", human);
  const approvalCount = member.role === "member"
    ? num(row(db, "SELECT COUNT(*) AS c FROM proposals WHERE workspace_id = ? AND requester_user_id = ? AND state = 'REVIEW_REQUIRED'", [human.workspaceId, human.userId])?.c)
    : num(row(db, "SELECT COUNT(*) AS c FROM proposals WHERE workspace_id = ? AND state = 'REVIEW_REQUIRED'", [human.workspaceId])?.c);
  const events = listEvents(db, human, null, 8);
  const worker = row(db, "SELECT last_seen_at FROM worker_status WHERE id = 'primary'");
  const dueJobs = num(row(db, "SELECT COUNT(*) AS c FROM jobs j JOIN proposals p ON p.id = j.subject_id WHERE j.state = 'DUE' AND p.workspace_id = ?", [human.workspaceId])?.c);
  return {
    role: member.role,
    accounts: wallets,
    registrations,
    taskCounts,
    approvalCount,
    events,
    worker: { lastSeenAt: worker ? num(worker.last_seen_at) : null, dueJobs },
  };
}

export function listEvents(db: DatabaseSync, human: HumanContext, cursor: number | null, limit: number) {
  requireHuman(db, human);
  const bounded = Math.min(Math.max(limit, 1), 50);
  const params: Array<string | number> = [human.workspaceId];
  let sql = "SELECT * FROM audit_events WHERE workspace_id = ?";
  if (human.role === "member") {
    sql += " AND (actor_user_id = ? OR (subject_type = 'task' AND subject_id IN (SELECT id FROM tasks WHERE workspace_id = ? AND (controller_user_id = ? OR intent_author_user_id = ?))) OR (subject_type = 'proposal' AND subject_id IN (SELECT id FROM proposals WHERE workspace_id = ? AND requester_user_id = ?)) OR (subject_type = 'registration' AND subject_id IN (SELECT id FROM registrations WHERE workspace_id = ? AND controller_user_id = ?)))";
    params.push(human.userId, human.workspaceId, human.userId, human.userId, human.workspaceId, human.userId, human.workspaceId, human.userId);
  }
  if (cursor) {
    sql += " AND id < ?";
    params.push(cursor);
  }
  sql += " ORDER BY id DESC LIMIT ?";
  params.push(bounded);
  const events = rows(db, sql, params).map(eventDto);
  return { events, nextCursor: events.length === bounded ? events[events.length - 1]!.id : null };
}

export function activityGraph(db: DatabaseSync, human: HumanContext, taskId?: string) {
  requireHuman(db, human);
  const task = taskId
    ? row(db, "SELECT * FROM tasks WHERE id = ? AND workspace_id = ?", [taskId, human.workspaceId])
    : human.role === "member"
      ? row(db, "SELECT * FROM tasks WHERE workspace_id = ? AND (controller_user_id = ? OR intent_author_user_id = ?) ORDER BY updated_at DESC LIMIT 1", [human.workspaceId, human.userId, human.userId])
      : row(db, "SELECT * FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1", [human.workspaceId]);
  if (!task) return { nodes: [], edges: [] };
  if (human.role === "member" && text(task.controller_user_id) !== human.userId && text(task.intent_author_user_id) !== human.userId) {
    return { nodes: [], edges: [] };
  }
  const registration = row(db, "SELECT id, name FROM registrations WHERE id = ?", [text(task.registration_id)]);
  const proposal = row(db, "SELECT * FROM proposals WHERE task_id = ? ORDER BY created_at DESC LIMIT 1", [text(task.id)]);
  const nodes = [
    node("registration", registration ? text(registration.id) : "registration", registration ? text(registration.name) : "Registration", 0, 0),
    node("task", text(task.id), text(task.title), 1, 0),
  ];
  const edges = [{ id: "e-reg-task", source: registration ? text(registration.id) : "registration", target: text(task.id) }];
  if (proposal) {
    nodes.push(node("proposal", text(proposal.id), `${text(proposal.state)} · ${(num(proposal.amount_cents) / 100).toFixed(2)} USD`, 2, 0));
    edges.push({ id: "e-task-proposal", source: text(task.id), target: text(proposal.id) });
    nodes.push(node("decision", `${text(proposal.id)}-decision`, text(proposal.decision_codes), 3, 0));
    edges.push({ id: "e-proposal-decision", source: text(proposal.id), target: `${text(proposal.id)}-decision` });
    const approval = row(db, "SELECT id, decision FROM approvals WHERE proposal_id = ?", [text(proposal.id)]);
    if (approval) {
      nodes.push(node("approval", text(approval.id), text(approval.decision), 3, 1));
      edges.push({ id: "e-proposal-approval", source: text(proposal.id), target: text(approval.id) });
    }
    const reservation = row(db, "SELECT proposal_id, amount_cents FROM reservations WHERE proposal_id = ?", [text(proposal.id)]);
    if (reservation) {
      nodes.push(node("reservation", `${text(proposal.id)}-hold`, `Hold ${(num(reservation.amount_cents) / 100).toFixed(2)} USD`, 4, 0));
      edges.push({ id: "e-proposal-hold", source: text(proposal.id), target: `${text(proposal.id)}-hold` });
    }
    const operation = row(db, "SELECT * FROM payment_operations WHERE proposal_id = ?", [text(proposal.id)]);
    if (operation) {
      nodes.push(node("payment", text(operation.id), text(operation.state), 4, 1));
      edges.push({ id: "e-proposal-payment", source: text(proposal.id), target: text(operation.id) });
      if (operation.upstream_id) {
        nodes.push(node("receipt", text(operation.upstream_id), `Upstream ${text(operation.upstream_id)}`, 5, 1));
        edges.push({ id: "e-payment-receipt", source: text(operation.id), target: text(operation.upstream_id) });
      }
    }
  }
  return { nodes, edges };
}

function node(kind: string, id: string, label: string, column: number, rowIndex: number) {
  return { id, kind, label, position: { x: column * 240, y: rowIndex * 120 } };
}

function eventDto(item: SqlRow) {
  return {
    id: num(item.id),
    eventType: text(item.event_type),
    actorKind: text(item.actor_kind),
    actorUserId: item.actor_user_id ? text(item.actor_user_id) : null,
    subjectType: text(item.subject_type),
    subjectId: text(item.subject_id),
    detail: JSON.parse(text(item.safe_detail_json) || "{}") as Record<string, unknown>,
    createdAt: num(item.created_at),
  };
}

function countBy(db: DatabaseSync, table: "tasks", human: HumanContext) {
  const filter = human.role === "member" ? "AND (controller_user_id = ? OR intent_author_user_id = ?)" : "";
  const params = human.role === "member" ? [human.workspaceId, human.userId, human.userId] : [human.workspaceId];
  const items = rows(db, `SELECT state, COUNT(*) AS c FROM ${table} WHERE workspace_id = ? ${filter} GROUP BY state`, params);
  const counts: Record<string, number> = {};
  for (const item of items) counts[text(item.state)] = num(item.c);
  return counts;
}
