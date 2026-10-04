import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { MerchantCategory } from "../contracts/constants";
import { conflict, forbidden, invalid } from "../contracts/errors";
import { MAX_AMOUNT_CENTS } from '../contracts/money';
import { getEnv } from "../server/env";
import { atomic, num, row, rows, run, text } from "../storage/sql";
import { assertCanApprove, assertFreshAuth, audit, requireActiveMember, requireHuman, type ConnectorContext, type HumanContext } from "./access";
import { effectiveCategory } from "./accounts";
import { mandateDto } from "./authority";
import { canonicalHash, id, randomToken, sha256 } from "./ids";
import { evaluatePolicy, type PolicyInput } from "./policy";
import { requireWorkspace } from "./workspaces";

export type PurchaseTerms = {
  taskId: string;
  revision: number;
  leaseToken: string;
  merchantId: string;
  amountCents: number;
  reason: string;
};

export function createTask(
  db: DatabaseSync,
  human: HumanContext,
  input: {
    registrationId: string;
    kind: "RESEARCH" | "PURCHASE";
    title: string;
    requestedOutcome: string;
    mandateId?: string | null;
    requestKey?: string;
  },
  now: number,
) {
  return atomic(db, () => {
    const member = requireHuman(db, human);
    if (!input.title.trim() || input.title.trim().length > 120 || !input.requestedOutcome.trim() || input.requestedOutcome.trim().length > 2000) throw invalid('INVALID_TASK', 'Use a title of 1–120 characters and an outcome of 1–2000 characters.');
    const bodyHash = canonicalHash({ workspaceId: human.workspaceId, registrationId: input.registrationId, kind: input.kind, title: input.title, requestedOutcome: input.requestedOutcome, mandateId: input.mandateId ?? null });
    if (input.requestKey) {
      const replay = replayOf(db, human.userId, "task", input.requestKey, bodyHash);
      if (replay) return replay;
    }
    const registration = row(db, "SELECT * FROM registrations WHERE id = ? AND workspace_id = ?", [input.registrationId, human.workspaceId]);
    if (!registration || text(registration.state) === "ARCHIVED") throw invalid("REGISTRATION_MISSING", "Choose an available registration.");
    const controller = text(registration.controller_user_id);
    if (controller !== human.userId && member.role !== "owner") {
      throw forbidden("You can only assign work to a bot you control.", "TASK_FORBIDDEN");
    }
    let mandateId: string | null = null;
    let walletId: string | null = null;
    if (input.kind === "PURCHASE") {
      if (!input.mandateId) throw invalid("MANDATE_MISSING", "A purchase task needs an explicit mandate.");
      const mandate = row(db, "SELECT * FROM mandates WHERE id = ? AND workspace_id = ?", [input.mandateId, human.workspaceId]);
      if (!mandate) throw invalid("MANDATE_MISSING", "That mandate is not in this workspace.");
      if (text(mandate.state) !== 'ACTIVE' || num(mandate.expires_at) <= now) throw invalid('MANDATE_EXPIRED', 'Select a current spending mandate.');
      if (text(mandate.registration_id) !== input.registrationId || text(mandate.controller_user_id) !== controller) {
        throw invalid("MANDATE_BINDING", "The mandate does not belong to this registration.");
      }
      mandateId = text(mandate.id);
      walletId = text(mandate.wallet_id);
    }
    const taskId = id();
    run(
      db,
      `INSERT INTO tasks (
        id, workspace_id, registration_id, controller_user_id, mandate_id, wallet_id, kind, title,
        requested_outcome, revision, state, created_by, intent_author_user_id, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'QUEUED', ?, ?, 1, ?, ?)`,
      [taskId, human.workspaceId, input.registrationId, controller, mandateId, walletId, input.kind, input.title.trim(), input.requestedOutcome.trim(), human.userId, human.userId, now, now],
    );
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "TASK_CREATED",
      subjectType: "task",
      subjectId: taskId,
      detail: { kind: input.kind, registrationId: input.registrationId, mandateId },
      at: now,
    });
    const dto = taskDto(db, taskId);
    storeReplay(db, human.workspaceId, human.userId, "task", input.requestKey, bodyHash, dto, now);
    return dto;
  });
}

export function listTasks(db: DatabaseSync, human: HumanContext) {
  requireHuman(db, human);
  const filter = human.role === "member" ? "AND (controller_user_id = ? OR intent_author_user_id = ?)" : "";
  const params: SQLInputValue[] = human.role === "member"
    ? [human.workspaceId, human.userId, human.userId]
    : [human.workspaceId];
  return rows(db, `SELECT id FROM tasks WHERE workspace_id = ? ${filter} ORDER BY created_at DESC LIMIT 100`, params).map((item) => taskDto(db, text(item.id)));
}

export function getTask(db: DatabaseSync, human: HumanContext, taskId: string) {
  requireHuman(db, human);
  const task = taskDto(db, taskId);
  if (task.workspaceId !== human.workspaceId) throw invalid("TASK_MISSING", "That task is not available.");
  if (human.role === "member" && task.controllerUserId !== human.userId && task.intentAuthorUserId !== human.userId) {
    throw invalid("TASK_MISSING", "That task is not available.");
  }
  return {
    ...task,
    instructions: instructionRows(db, taskId),
    updates: rows(db, "SELECT * FROM task_updates WHERE task_id = ? ORDER BY created_at ASC", [taskId]).map(updateDto),
    proposals: rows(db, "SELECT id FROM proposals WHERE task_id = ? ORDER BY created_at ASC", [taskId]).map((item) => proposalDto(db, text(item.id))),
  };
}

export function queueInstruction(
  db: DatabaseSync,
  human: HumanContext,
  taskId: string,
  textValue: string,
  source: "HUMAN_UI" | "VOICE",
  now: number,
  requestKey?: string,
) {
  return atomic(db, () => {
    requireHuman(db, human);
    const task = requireTaskVisible(db, human, taskId);
    if (!textValue.trim() || textValue.trim().length > 2000) throw invalid('INVALID_INSTRUCTION', 'Use an instruction of 1–2000 characters.');
    if (['COMPLETED', 'CANCELLED'].includes(text(task.state))) throw conflict('TASK_CLOSED', 'This task is closed. Create a new task for new work.');
    const bodyHash = canonicalHash({ taskId, text: textValue, source });
    if (requestKey) {
      const replay = replayOf(db, human.userId, "instruction", requestKey, bodyHash);
      if (replay) return replay;
    }
    const instructionId = id();
    run(
      db,
      `INSERT INTO instructions (
        id, task_id, registration_id, workspace_id, authored_by, source, text, state, revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)`,
      [instructionId, taskId, text(task.registration_id), human.workspaceId, human.userId, source, textValue.trim(), num(task.revision), now],
    );
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "INSTRUCTION_QUEUED",
      subjectType: "instruction",
      subjectId: instructionId,
      detail: { taskId, source, state: "QUEUED" },
      at: now,
    });
    const dto = { id: instructionId, state: "QUEUED", createdAt: now, text: textValue.trim() };
    storeReplay(db, human.workspaceId, human.userId, "instruction", requestKey, bodyHash, dto, now);
    return dto;
  });
}

export function cancelTask(db: DatabaseSync, human: HumanContext, taskId: string, now: number) {
  return atomic(db, () => {
    requireHuman(db, human);
    const task = requireTaskVisible(db, human, taskId);
    if (human.role === "member" && text(task.controller_user_id) !== human.userId && text(task.intent_author_user_id) !== human.userId) {
      throw forbidden("You cannot cancel this task.", "CANCEL_FORBIDDEN");
    }
    const irreversible = row(
      db,
      "SELECT id FROM proposals WHERE task_id = ? AND state IN ('SUBMITTING','SUBMITTED_PENDING','RECONCILE_REQUIRED','COMPLETED')",
      [taskId],
    );
    if (irreversible) throw conflict("ALREADY_SUBMITTED", "A submitted or completed purchase cannot be cancelled here.");
    const proposals = rows(db, "SELECT id FROM proposals WHERE task_id = ? AND state IN ('RESERVED','REVIEW_REQUIRED','BLOCKED')", [taskId]);
    for (const proposal of proposals) {
      run(db, "DELETE FROM reservations WHERE proposal_id = ?", [text(proposal.id)]);
      run(db, "UPDATE proposals SET state = 'CANCELLED', cancel_reason = 'TASK_CANCELLED', updated_at = ? WHERE id = ?", [now, text(proposal.id)]);
      run(db, "UPDATE jobs SET state = 'FAILED', error_code = 'TASK_CANCELLED' WHERE subject_id = ? AND state = 'DUE'", [text(proposal.id)]);
    }
    run(db, "UPDATE tasks SET state = 'CANCELLED', updated_at = ?, version = version + 1 WHERE id = ?", [now, taskId]);
    run(db, "DELETE FROM task_leases WHERE task_id = ?", [taskId]);
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "WORK_CANCELLED",
      subjectType: "task",
      subjectId: taskId,
      detail: {},
      at: now,
    });
    return taskDto(db, taskId);
  });
}

export function claimTask(db: DatabaseSync, ctx: ConnectorContext, taskId: string | undefined, now: number) {
  return atomic(db, () => {
    requireActiveMember(db, ctx.workspaceId, ctx.userId);
    if (!ctx.scopes.has("tasks:read") || !ctx.scopes.has("tasks:update")) throw forbidden("This connection cannot claim tasks.", "SCOPE");
    const registration = row(db, "SELECT * FROM registrations WHERE id = ? AND workspace_id = ?", [ctx.registrationId, ctx.workspaceId]);
    if (!registration || text(registration.state) !== "ACTIVE") throw forbidden("This registration cannot claim new work.", "REGISTRATION_PAUSED");
    const connection = row(db, "SELECT state FROM connections WHERE id = ? AND state = 'ACTIVE' AND workspace_id = ? AND registration_id = ? AND user_id = ?", [ctx.connectionId, ctx.workspaceId, ctx.registrationId, ctx.userId]);
    if (!connection) throw forbidden("This connection is not active.", "CONNECTION_REVOKED");
    const task = taskId
      ? row(db, "SELECT * FROM tasks WHERE id = ? AND workspace_id = ? AND registration_id = ? AND controller_user_id = ?", [taskId, ctx.workspaceId, ctx.registrationId, ctx.userId])
      : row(
          db,
          `SELECT * FROM tasks WHERE workspace_id = ? AND registration_id = ? AND controller_user_id = ? AND state = 'QUEUED'
           ORDER BY created_at ASC LIMIT 1`,
          [ctx.workspaceId, ctx.registrationId, ctx.userId],
        );
    if (!task) throw invalid("TASK_MISSING", "There is no task waiting for this registration.");
    const lease = row(db, "SELECT * FROM task_leases WHERE task_id = ?", [text(task.id)]);
    if (lease && num(lease.expires_at) > now && text(lease.connection_id) !== ctx.connectionId) {
      throw conflict("LEASE_HELD", "Another connection currently holds this task.");
    }
    if (["WAITING_PAYMENT", "NEEDS_RECONCILIATION", "COMPLETED", "CANCELLED"].includes(text(task.state))) {
      throw conflict("TASK_NOT_CLAIMABLE", "This task is not available to claim.");
    }
    const activeProposal = row(
      db,
      "SELECT id FROM proposals WHERE task_id = ? AND state IN ('RESERVED','SUBMITTING','SUBMITTED_PENDING','RECONCILE_REQUIRED','COMPLETED')",
      [text(task.id)],
    );
    if (activeProposal) {
      throw conflict("TASK_NOT_CLAIMABLE", "This task already has a financial commitment.");
    }
    const token = randomToken("lease");
    run(db, "UPDATE tasks SET state = 'IN_PROGRESS', updated_at = ?, version = version + 1 WHERE id = ?", [now, text(task.id)]);
    run(db, "DELETE FROM task_leases WHERE task_id = ?", [text(task.id)]);
    const leaseSeconds = safeLeaseSeconds();
    run(
      db,
      "INSERT INTO task_leases (task_id, connection_id, token_hash, expires_at, renewed_at) VALUES (?, ?, ?, ?, ?)",
      [text(task.id), ctx.connectionId, sha256(token), now + leaseSeconds * 1000, now],
    );
    audit(db, {
      workspaceId: ctx.workspaceId,
      actorKind: "connector",
      actorUserId: ctx.userId,
      connectionId: ctx.connectionId,
      eventType: "TASK_CLAIMED",
      subjectType: "task",
      subjectId: text(task.id),
      detail: { revision: num(task.revision) },
      at: now,
    });
    return {
      task: taskDto(db, text(task.id)),
      leaseToken: token,
      instructions: instructionRows(db, text(task.id)).filter((item) => item.state === "QUEUED"),
    };
  });
}

export function updateTask(
  db: DatabaseSync,
  ctx: ConnectorContext,
  input: { taskId: string; revision: number; leaseToken: string; phase: string; note: string; evidence: unknown; appliedInstructionIds?: string[] },
  now: number,
) {
  return atomic(db, () => {
    const task = requireLease(db, ctx, input.taskId, input.revision, input.leaseToken, now);
    if (input.phase.toLowerCase() === "completed" && text(task.kind) === "PURCHASE") {
      throw forbidden("Purchase completion comes from the bank receipt, not a progress note.", "COMPLETION_FORBIDDEN");
    }
    const updateId = id();
    run(
      db,
      "INSERT INTO task_updates (id, task_id, connection_id, kind, phase, note, evidence_json, created_at) VALUES (?, ?, ?, 'REPORTED', ?, ?, ?, ?)",
      [updateId, input.taskId, ctx.connectionId, input.phase.slice(0, 80), input.note.slice(0, 2000), JSON.stringify(sanitizeEvidence(input.evidence)), now],
    );
    renewLease(db, input.taskId, now);
    for (const instructionId of input.appliedInstructionIds ?? []) {
      run(
        db,
        "UPDATE instructions SET state = 'APPLIED', applied_at = ?, reported_outcome = ? WHERE id = ? AND task_id = ? AND state != 'APPLIED'",
        [now, input.note.slice(0, 500), instructionId, input.taskId],
      );
    }
    audit(db, {
      workspaceId: ctx.workspaceId,
      actorKind: "connector",
      actorUserId: ctx.userId,
      connectionId: ctx.connectionId,
      eventType: "TASK_REPORTED",
      subjectType: "task",
      subjectId: input.taskId,
      detail: { phase: input.phase.slice(0, 80) },
      at: now,
    });
    return { id: updateId, phase: input.phase, task: taskDto(db, input.taskId) };
  });
}

export function acknowledgeInstruction(db: DatabaseSync, ctx: ConnectorContext, input: { instructionId: string; taskId: string; revision: number; leaseToken: string }, now: number) {
  return atomic(db, () => {
    requireLease(db, ctx, input.taskId, input.revision, input.leaseToken, now);
    const instruction = row(db, "SELECT * FROM instructions WHERE id = ? AND task_id = ?", [input.instructionId, input.taskId]);
    if (!instruction) throw invalid("INSTRUCTION_MISSING", "That instruction is not on this task.");
    if (text(instruction.state) === "QUEUED") {
      run(db, "UPDATE instructions SET state = 'ACKNOWLEDGED', acknowledged_at = ? WHERE id = ?", [now, input.instructionId]);
      audit(db, {
        workspaceId: ctx.workspaceId,
        actorKind: "connector",
        actorUserId: ctx.userId,
        connectionId: ctx.connectionId,
        eventType: "INSTRUCTION_ACKNOWLEDGED",
        subjectType: "instruction",
        subjectId: input.instructionId,
        detail: {},
        at: now,
      });
    }
    return instructionRows(db, input.taskId).find((item) => item.id === input.instructionId);
  });
}

export function completeResearch(db: DatabaseSync, ctx: ConnectorContext, input: { taskId: string; revision: number; leaseToken: string; output: string; evidence: unknown }, now: number) {
  return atomic(db, () => {
    const task = requireLease(db, ctx, input.taskId, input.revision, input.leaseToken, now);
    if (text(task.kind) !== "RESEARCH") throw forbidden("Only a research task can be completed by the bot.", "RESEARCH_ONLY");
    run(
      db,
      "INSERT INTO task_updates (id, task_id, connection_id, kind, phase, note, evidence_json, created_at) VALUES (?, ?, ?, 'RESEARCH_OUTPUT', 'complete', ?, ?, ?)",
      [id(), input.taskId, ctx.connectionId, input.output.slice(0, 4000), JSON.stringify(sanitizeEvidence(input.evidence)), now],
    );
    run(db, "UPDATE tasks SET state = 'COMPLETED', updated_at = ?, version = version + 1 WHERE id = ?", [now, input.taskId]);
    run(db, "DELETE FROM task_leases WHERE task_id = ?", [input.taskId]);
    return taskDto(db, input.taskId);
  });
}

export function revisePlan(db: DatabaseSync, ctx: ConnectorContext, input: { taskId: string; expectedRevision: number; leaseToken: string; reason: string }, now: number) {
  return atomic(db, () => {
    const task = requireLease(db, ctx, input.taskId, input.expectedRevision, input.leaseToken, now);
    if (text(task.state) === "COMPLETED") throw conflict("TASK_COMPLETED", "A completed purchase task cannot be revised into another purchase.");
    const blocked = row(
      db,
      "SELECT id FROM proposals WHERE task_id = ? AND state IN ('SUBMITTING','SUBMITTED_PENDING','RECONCILE_REQUIRED','COMPLETED')",
      [input.taskId],
    );
    if (blocked) throw conflict("ALREADY_SUBMITTED", "An irreversible banking operation is already recorded.");
    const open = rows(db, "SELECT id, state FROM proposals WHERE task_id = ? AND task_revision = ? AND state IN ('BLOCKED','REVIEW_REQUIRED','RESERVED')", [input.taskId, input.expectedRevision]);
    for (const proposal of open) {
      const state = text(proposal.state);
      if (state === "RESERVED") {
        run(db, "DELETE FROM reservations WHERE proposal_id = ?", [text(proposal.id)]);
        run(db, "UPDATE jobs SET state = 'FAILED', error_code = 'REVISED' WHERE subject_id = ? AND state = 'DUE'", [text(proposal.id)]);
      }
      run(db, "UPDATE proposals SET state = 'CANCELLED', cancel_reason = 'REVISED', updated_at = ? WHERE id = ?", [now, text(proposal.id)]);
    }
    const next = input.expectedRevision + 1;
    run(db, "UPDATE tasks SET revision = ?, state = 'IN_PROGRESS', updated_at = ?, version = version + 1 WHERE id = ?", [next, now, input.taskId]);
    audit(db, {
      workspaceId: ctx.workspaceId,
      actorKind: "connector",
      actorUserId: ctx.userId,
      connectionId: ctx.connectionId,
      eventType: "TASK_REPORTED",
      subjectType: "task",
      subjectId: input.taskId,
      detail: { revision: next, reason: input.reason.slice(0, 300) },
      at: now,
    });
    return { taskId: input.taskId, revision: next };
  });
}

export function submitPurchase(db: DatabaseSync, ctx: ConnectorContext, terms: PurchaseTerms, now: number) {
  return atomic(db, () => {
    if (!ctx.scopes.has("proposals:write")) throw forbidden("This connection cannot propose purchases.", "SCOPE");
    const task = requireLease(db, ctx, terms.taskId, terms.revision, terms.leaseToken, now);
    if (text(task.kind) !== "PURCHASE") throw invalid("RESEARCH_TASK", "This task is not a purchase.");
    const termsHash = purchaseHash(terms, text(task.mandate_id), text(task.wallet_id));
    const existing = row(db, "SELECT * FROM proposals WHERE task_id = ? AND task_revision = ?", [terms.taskId, terms.revision]);
    if (existing) {
      if (text(existing.terms_hash) === termsHash) return proposalDto(db, text(existing.id));
      throw conflict("TERMS_CONFLICT", "This task revision already has different purchase terms.");
    }
    if (!Number.isSafeInteger(terms.amountCents) || terms.amountCents <= 0 || terms.amountCents > MAX_AMOUNT_CENTS) throw invalid('INVALID_AMOUNT', 'Use a positive supported integer number of cents.');
    if (!row(db, 'SELECT id FROM merchant_catalog WHERE id = ?', [terms.merchantId])) throw invalid('MERCHANT_UNKNOWN', 'Choose a merchant in the current catalog.');
    const decision = decide(db, {
      now,
      mode: "new",
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      registrationId: ctx.registrationId,
      connectionAllowsWork: true,
      task,
      merchantId: terms.merchantId,
      amountCents: terms.amountCents,
    });
    const proposalId = id();
    run(
      db,
      `INSERT INTO proposals (
        id, workspace_id, task_id, task_revision, mandate_id, wallet_id, requester_user_id, registration_id,
        merchant_id, currency, amount_cents, reason, terms_hash, state, decision_codes, explanation, available_cents,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        proposalId, ctx.workspaceId, terms.taskId, terms.revision, text(task.mandate_id), text(task.wallet_id),
        text(task.intent_author_user_id), ctx.registrationId, terms.merchantId, terms.amountCents, terms.reason.slice(0, 1000),
        termsHash, decision.outcome === "RESERVED" ? "RESERVED" : decision.outcome, JSON.stringify(decision.codes),
        decision.explanation, decision.availableCents, now, now,
      ],
    );
    let taskState = "BLOCKED";
    let event = "PROPOSAL_BLOCKED";
    if (decision.outcome === "REVIEW_REQUIRED") {
      taskState = "WAITING_APPROVAL";
      event = "REVIEW_REQUIRED";
    }
    if (decision.outcome === "RESERVED") {
      taskState = "WAITING_PAYMENT";
      event = "FUNDS_RESERVED";
      run(db, "INSERT INTO reservations (proposal_id, wallet_id, mandate_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)", [
        proposalId, text(task.wallet_id), text(task.mandate_id), terms.amountCents, now,
      ]);
      run(db, "INSERT INTO jobs (id, kind, subject_id, state, run_after, attempt_count) VALUES (?, 'payment', ?, 'DUE', ?, 0)", [id(), proposalId, now]);
    }
    run(db, "UPDATE tasks SET state = ?, updated_at = ?, version = version + 1 WHERE id = ?", [taskState, now, terms.taskId]);
    audit(db, {
      workspaceId: ctx.workspaceId,
      actorKind: "connector",
      actorUserId: ctx.userId,
      connectionId: ctx.connectionId,
      eventType: event,
      subjectType: "proposal",
      subjectId: proposalId,
      detail: { codes: decision.codes, amountCents: terms.amountCents },
      at: now,
    });
    renewLease(db, terms.taskId, now);
    return proposalDto(db, proposalId);
  });
}

export function approveProposal(db: DatabaseSync, human: HumanContext, proposalId: string, termsHash: string, now: number) {
  return atomic(db, () => {
    const member = requireHuman(db, human);
    assertCanApprove(member);
    assertFreshAuth(db, human.sessionId, human.userId, now);
    const proposal = requireProposal(db, human.workspaceId, proposalId);
    if (text(proposal.state) !== "REVIEW_REQUIRED") throw conflict("PROPOSAL_STATE", "Only a proposal waiting for review can be approved.");
    if (text(proposal.terms_hash) !== termsHash) throw conflict("TERMS_CONFLICT", "The proposal terms changed. Refresh before deciding.");
    const workspace = requireWorkspace(db, human.workspaceId);
    const task = row(db, "SELECT * FROM tasks WHERE id = ?", [text(proposal.task_id)])!;
    const blockedPeople = new Set([text(proposal.requester_user_id), text(task.controller_user_id), text(task.intent_author_user_id)]);
    if (workspace.kind === "BUSINESS" && blockedPeople.has(human.userId)) {
      throw forbidden("You cannot approve a request you made or control.", "SELF_APPROVAL");
    }
    if (workspace.kind === "PERSONAL" && human.role !== "owner") throw forbidden("You cannot approve this request.", "APPROVAL_FORBIDDEN");
    const decision = decide(db, {
      now,
      mode: "new",
      workspaceId: human.workspaceId,
      userId: text(task.controller_user_id),
      registrationId: text(proposal.registration_id),
      connectionAllowsWork: true,
      task,
      merchantId: text(proposal.merchant_id),
      amountCents: num(proposal.amount_cents),
    });
    run(db, "INSERT INTO approvals (id, proposal_id, approver_user_id, decision, terms_hash, created_at) VALUES (?, ?, ?, 'APPROVED', ?, ?)", [
      id(), proposalId, human.userId, termsHash, now,
    ]);
    if (decision.outcome === "BLOCKED") {
      run(db, "UPDATE proposals SET state = 'BLOCKED', decision_codes = ?, explanation = ?, available_cents = ?, updated_at = ? WHERE id = ?", [
        JSON.stringify(decision.codes), decision.explanation, decision.availableCents, now, proposalId,
      ]);
      run(db, "UPDATE tasks SET state = 'BLOCKED', updated_at = ? WHERE id = ?", [now, text(proposal.task_id)]);
      audit(db, {
        workspaceId: human.workspaceId,
        actorKind: "human",
        actorUserId: human.userId,
        eventType: "PROPOSAL_BLOCKED",
        subjectType: "proposal",
        subjectId: proposalId,
        detail: { codes: decision.codes, atApproval: true },
        at: now,
      });
      return proposalDto(db, proposalId);
    }
    run(db, "UPDATE proposals SET state = 'RESERVED', decision_codes = ?, explanation = ?, updated_at = ? WHERE id = ?", [
      JSON.stringify(["APPROVED"]), "Approved after a fresh limit check.", now, proposalId,
    ]);
    run(db, "INSERT INTO reservations (proposal_id, wallet_id, mandate_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)", [
      proposalId, text(proposal.wallet_id), text(proposal.mandate_id), num(proposal.amount_cents), now,
    ]);
    run(db, "INSERT INTO jobs (id, kind, subject_id, state, run_after, attempt_count) VALUES (?, 'payment', ?, 'DUE', ?, 0)", [id(), proposalId, now]);
    run(db, "UPDATE tasks SET state = 'WAITING_PAYMENT', updated_at = ? WHERE id = ?", [now, text(proposal.task_id)]);
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "PURCHASE_APPROVED",
      subjectType: "proposal",
      subjectId: proposalId,
      detail: { termsHash },
      at: now,
    });
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "FUNDS_RESERVED",
      subjectType: "proposal",
      subjectId: proposalId,
      detail: { amountCents: num(proposal.amount_cents) },
      at: now,
    });
    return proposalDto(db, proposalId);
  });
}

export function rejectProposal(db: DatabaseSync, human: HumanContext, proposalId: string, termsHash: string, now: number) {
  return atomic(db, () => {
    const member = requireHuman(db, human);
    assertCanApprove(member);
    assertFreshAuth(db, human.sessionId, human.userId, now);
    const proposal = requireProposal(db, human.workspaceId, proposalId);
    if (text(proposal.state) !== "REVIEW_REQUIRED") throw conflict("PROPOSAL_STATE", "Only a proposal waiting for review can be rejected.");
    if (text(proposal.terms_hash) !== termsHash) throw conflict("TERMS_CONFLICT", "The proposal terms changed. Refresh before deciding.");
    run(db, "INSERT INTO approvals (id, proposal_id, approver_user_id, decision, terms_hash, created_at) VALUES (?, ?, ?, 'REJECTED', ?, ?)", [
      id(), proposalId, human.userId, termsHash, now,
    ]);
    run(db, "UPDATE proposals SET state = 'CANCELLED', cancel_reason = 'HUMAN_REJECTED', updated_at = ? WHERE id = ?", [now, proposalId]);
    run(db, "UPDATE tasks SET state = 'BLOCKED', updated_at = ? WHERE id = ?", [now, text(proposal.task_id)]);
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "PURCHASE_REJECTED",
      subjectType: "proposal",
      subjectId: proposalId,
      detail: { reason: "HUMAN_REJECTED" },
      at: now,
    });
    return proposalDto(db, proposalId);
  });
}

export function cancelProposal(db: DatabaseSync, human: HumanContext, proposalId: string, now: number) {
  return atomic(db, () => {
    requireHuman(db, human);
    const proposal = requireProposal(db, human.workspaceId, proposalId);
    requireTaskVisible(db, human, text(proposal.task_id));
    if (!["REVIEW_REQUIRED", "RESERVED", "BLOCKED"].includes(text(proposal.state))) {
      throw conflict("ALREADY_SUBMITTED", "Only an unsubmitted proposal can be cancelled.");
    }
    run(db, "DELETE FROM reservations WHERE proposal_id = ?", [proposalId]);
    run(db, "UPDATE proposals SET state = 'CANCELLED', cancel_reason = 'HUMAN_CANCELLED', updated_at = ? WHERE id = ?", [now, proposalId]);
    run(db, "UPDATE jobs SET state = 'FAILED', error_code = 'HUMAN_CANCELLED' WHERE subject_id = ? AND state = 'DUE'", [proposalId]);
    run(db, "UPDATE tasks SET state = 'CANCELLED', updated_at = ? WHERE id = ? AND state != 'COMPLETED'", [now, text(proposal.task_id)]);
    audit(db, {
      workspaceId: human.workspaceId,
      actorKind: "human",
      actorUserId: human.userId,
      eventType: "WORK_CANCELLED",
      subjectType: "proposal",
      subjectId: proposalId,
      detail: {},
      at: now,
    });
    return proposalDto(db, proposalId);
  });
}

export function listProposals(db: DatabaseSync, human: HumanContext) {
  requireHuman(db, human);
  const filter = human.role === "member" ? "AND requester_user_id = ?" : "";
  const params: SQLInputValue[] = human.role === "member" ? [human.workspaceId, human.userId] : [human.workspaceId];
  return rows(db, `SELECT id FROM proposals WHERE workspace_id = ? ${filter} ORDER BY created_at DESC LIMIT 100`, params).map((item) => proposalDto(db, text(item.id)));
}

export function getProposal(db: DatabaseSync, human: HumanContext, proposalId: string) {
  requireHuman(db, human);
  const proposal = requireProposal(db, human.workspaceId, proposalId);
  if (human.role === "member" && text(proposal.requester_user_id) !== human.userId) {
    throw invalid("PROPOSAL_MISSING", "That proposal is not available.");
  }
  return proposalDto(db, proposalId);
}

export function proposalDto(db: DatabaseSync, proposalId: string) {
  const proposal = row(db, "SELECT * FROM proposals WHERE id = ?", [proposalId]);
  if (!proposal) throw invalid("PROPOSAL_MISSING", "That proposal is not available.");
  const merchant = row(db, "SELECT label FROM merchant_catalog WHERE id = ?", [text(proposal.merchant_id)]);
  const approval = row(db, "SELECT approver_user_id, decision, terms_hash, created_at FROM approvals WHERE proposal_id = ? ORDER BY created_at DESC LIMIT 1", [proposalId]);
  const operation = row(db, "SELECT * FROM payment_operations WHERE proposal_id = ?", [proposalId]);
  return {
    id: proposalId,
    workspaceId: text(proposal.workspace_id),
    taskId: text(proposal.task_id),
    taskRevision: num(proposal.task_revision),
    mandateId: text(proposal.mandate_id),
    walletId: text(proposal.wallet_id),
    requesterUserId: text(proposal.requester_user_id),
    registrationId: text(proposal.registration_id),
    merchantId: text(proposal.merchant_id),
    merchantLabel: merchant ? text(merchant.label) : "Merchant",
    currency: "USD" as const,
    amountCents: num(proposal.amount_cents),
    reason: text(proposal.reason),
    termsHash: text(proposal.terms_hash),
    state: text(proposal.state),
    decisionCodes: JSON.parse(text(proposal.decision_codes)) as string[],
    explanation: text(proposal.explanation),
    availableCents: proposal.available_cents === null ? null : num(proposal.available_cents),
    cancelReason: proposal.cancel_reason ? text(proposal.cancel_reason) : null,
    createdAt: num(proposal.created_at),
    approval: approval ? {
      approverUserId: text(approval.approver_user_id),
      decision: text(approval.decision),
      termsHash: text(approval.terms_hash),
      createdAt: num(approval.created_at),
    } : null,
    payment: operation ? {
      id: text(operation.id),
      state: text(operation.state),
      upstreamId: operation.upstream_id ? text(operation.upstream_id) : null,
      reference: text(operation.upstream_reference),
      manualReview: num(operation.manual_review) === 1,
    } : null,
  };
}

export function taskDto(db: DatabaseSync, taskId: string) {
  const task = row(db, "SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (!task) throw invalid("TASK_MISSING", "That task is not available.");
  return {
    id: taskId,
    workspaceId: text(task.workspace_id),
    registrationId: text(task.registration_id),
    controllerUserId: text(task.controller_user_id),
    intentAuthorUserId: text(task.intent_author_user_id),
    mandateId: task.mandate_id ? text(task.mandate_id) : null,
    walletId: task.wallet_id ? text(task.wallet_id) : null,
    kind: text(task.kind),
    title: text(task.title),
    requestedOutcome: text(task.requested_outcome),
    revision: num(task.revision),
    state: text(task.state),
    version: num(task.version),
    createdAt: num(task.created_at),
    updatedAt: num(task.updated_at),
  };
}

function decide(db: DatabaseSync, input: {
  now: number;
  mode: "new" | "existing";
  workspaceId: string;
  userId: string;
  registrationId: string;
  connectionAllowsWork: boolean;
  task: Record<string, SQLInputValue | bigint | null | Uint8Array>;
  merchantId: string;
  amountCents: number;
  ownProposalId?: string;
}) {
  const member = row(db, "SELECT state FROM memberships WHERE workspace_id = ? AND user_id = ?", [input.workspaceId, input.userId]);
  const registration = row(db, "SELECT state, controller_user_id FROM registrations WHERE id = ?", [input.registrationId]);
  const mandateRow = input.task.mandate_id
    ? row(db, "SELECT * FROM mandates WHERE id = ?", [text(input.task.mandate_id)])
    : undefined;
  const wallet = input.task.wallet_id ? row(db, "SELECT * FROM wallets WHERE id = ?", [text(input.task.wallet_id)]) : undefined;
  const merchant = row(db, "SELECT * FROM merchant_catalog WHERE id = ?", [input.merchantId]);
  const protections = sumAmounts(db, "SELECT amount_cents FROM protections WHERE wallet_id = ? AND state = 'ACTIVE'", [text(input.task.wallet_id)]);
  const reservations = input.task.wallet_id
    ? rows(db, "SELECT proposal_id, mandate_id, amount_cents FROM reservations WHERE wallet_id = ?", [text(input.task.wallet_id)]).map((item) => ({
        proposalId: text(item.proposal_id),
        mandateId: text(item.mandate_id),
        amountCents: num(item.amount_cents),
      }))
    : [];
  const completed = mandateRow
    ? num(row(db, "SELECT COALESCE(SUM(amount_cents), 0) AS c FROM proposals WHERE mandate_id = ? AND state = 'COMPLETED'", [text(mandateRow.id)])?.c)
    : 0;
  const category = merchant
    ? effectiveCategory(db, input.workspaceId, text(merchant.id), text(merchant.verified_category))
    : null;
  const mandate = mandateRow ? mandateDto(mandateRow as unknown as Record<string, unknown>) : null;
  const policyInput: PolicyInput = {
    now: input.now,
    freshnessMs: safeFreshness(),
    mode: input.mode,
    member: Boolean(member && text(member.state) === "ACTIVE"),
    registrationState: (registration ? text(registration.state) : "ARCHIVED") as PolicyInput["registrationState"],
    connectionAllowsWork: input.connectionAllowsWork && text(registration?.state) === "ACTIVE",
    taskMatches: text(input.task.registration_id) === input.registrationId && text(input.task.controller_user_id) === input.userId,
    mandate: mandate ? { ...mandate, state: mandate.state as "ACTIVE" | "REVOKED" | "EXPIRED" } : null,
    expectedWalletId: text(input.task.wallet_id),
    expectedRegistrationId: input.registrationId,
    expectedControllerUserId: input.userId,
    merchantId: input.merchantId,
    merchantFound: Boolean(merchant),
    verifiedCategory: category as MerchantCategory | null,
    wallet: wallet ? {
      state: text(wallet.state) as "ACTIVE" | "QUARANTINED",
      policyBalanceCents: num(wallet.policy_balance_cents),
      lastVerifiedAt: num(wallet.last_verified_at),
    } : null,
    protectionsCents: protections,
    reservations,
    completedCommitmentCents: completed,
    amountCents: input.amountCents,
    ownProposalId: input.ownProposalId,
  };
  return evaluatePolicy(policyInput);
}

export function recheckExistingReservation(db: DatabaseSync, proposalId: string, now: number) {
  const proposal = row(db, "SELECT * FROM proposals WHERE id = ?", [proposalId]);
  if (!proposal) throw invalid("PROPOSAL_MISSING", "That proposal is not available.");
  const task = row(db, "SELECT * FROM tasks WHERE id = ?", [text(proposal.task_id)])!;
  return decide(db, {
    now,
    mode: "existing",
    workspaceId: text(proposal.workspace_id),
    userId: text(task.controller_user_id),
    registrationId: text(proposal.registration_id),
    connectionAllowsWork: Boolean(row(db, `SELECT c.id FROM task_leases l JOIN connections c ON c.id = l.connection_id
      WHERE l.task_id = ? AND c.state = 'ACTIVE' AND c.workspace_id = ? AND c.registration_id = ? AND c.user_id = ?`, [text(task.id), text(proposal.workspace_id), text(proposal.registration_id), text(task.controller_user_id)])),
    task,
    merchantId: text(proposal.merchant_id),
    amountCents: num(proposal.amount_cents),
    ownProposalId: proposalId,
  });
}

function requireLease(db: DatabaseSync, ctx: ConnectorContext, taskId: string, revision: number, leaseToken: string, now: number) {
  requireActiveMember(db, ctx.workspaceId, ctx.userId);
  const connection = row(db, 'SELECT id FROM connections WHERE id = ? AND workspace_id = ? AND registration_id = ? AND user_id = ? AND state = ?', [ctx.connectionId, ctx.workspaceId, ctx.registrationId, ctx.userId, 'ACTIVE']);
  if (!connection) throw forbidden('This connection is no longer active.', 'CONNECTION_REVOKED');
  if (!ctx.scopes.has("tasks:update")) throw forbidden("This connection cannot update tasks.", "SCOPE");
  const task = row(
    db,
    "SELECT * FROM tasks WHERE id = ? AND workspace_id = ? AND registration_id = ? AND controller_user_id = ?",
    [taskId, ctx.workspaceId, ctx.registrationId, ctx.userId],
  );
  if (!task) throw invalid("TASK_MISSING", "That task is not available to this connection.");
  if (['COMPLETED', 'CANCELLED', 'PAUSED'].includes(text(task.state))) throw conflict('TASK_CLOSED', 'This task cannot accept more agent work.');
  const registration = row(db, "SELECT state FROM registrations WHERE id = ?", [ctx.registrationId]);
  if (!registration || text(registration.state) !== "ACTIVE") throw forbidden("This registration is not allowed to change work.", "REGISTRATION_PAUSED");
  if (num(task.revision) !== revision) throw conflict("STALE_REVISION", "The task revision is no longer current.");
  const lease = row(db, "SELECT * FROM task_leases WHERE task_id = ?", [taskId]);
  if (!lease || text(lease.connection_id) !== ctx.connectionId || num(lease.expires_at) <= now || text(lease.token_hash) !== sha256(leaseToken)) {
    throw forbidden("The task lease is missing or expired.", "LEASE_EXPIRED");
  }
  return task;
}

function requireTaskVisible(db: DatabaseSync, human: HumanContext, taskId: string) {
  const task = row(db, "SELECT * FROM tasks WHERE id = ? AND workspace_id = ?", [taskId, human.workspaceId]);
  if (!task) throw invalid("TASK_MISSING", "That task is not available.");
  if (human.role === "member" && text(task.controller_user_id) !== human.userId && text(task.intent_author_user_id) !== human.userId) {
    throw invalid("TASK_MISSING", "That task is not available.");
  }
  return task;
}

function requireProposal(db: DatabaseSync, workspaceId: string, proposalId: string) {
  const proposal = row(db, "SELECT * FROM proposals WHERE id = ? AND workspace_id = ?", [proposalId, workspaceId]);
  if (!proposal) throw invalid("PROPOSAL_MISSING", "That proposal is not available.");
  return proposal;
}

function purchaseHash(terms: PurchaseTerms, mandateId: string, walletId: string): string {
  return canonicalHash({
    action: "PURCHASE",
    taskId: terms.taskId,
    revision: terms.revision,
    mandateId,
    walletId,
    merchantId: terms.merchantId,
    currency: "USD",
    amountCents: terms.amountCents,
  });
}

function instructionRows(db: DatabaseSync, taskId: string) {
  return rows(db, "SELECT * FROM instructions WHERE task_id = ? ORDER BY created_at ASC", [taskId]).map((item) => ({
    id: text(item.id),
    state: text(item.state),
    text: text(item.text),
    source: text(item.source),
    createdAt: num(item.created_at),
    acknowledgedAt: item.acknowledged_at ? num(item.acknowledged_at) : null,
    appliedAt: item.applied_at ? num(item.applied_at) : null,
    reportedOutcome: item.reported_outcome ? text(item.reported_outcome) : null,
  }));
}

function updateDto(item: Record<string, SQLInputValue | bigint | null | Uint8Array>) {
  return {
    id: text(item.id),
    phase: text(item.phase),
    note: text(item.note),
    evidence: JSON.parse(text(item.evidence_json) || "[]"),
    createdAt: num(item.created_at),
    source: "Bot reported",
  };
}

function renewLease(db: DatabaseSync, taskId: string, now: number) {
  run(db, "UPDATE task_leases SET expires_at = ?, renewed_at = ? WHERE task_id = ?", [now + safeLeaseSeconds() * 1000, now, taskId]);
}

function replayOf(db: DatabaseSync, userId: string, action: string, requestKey: string, bodyHash: string) {
  const existing = row(
    db,
    "SELECT body_hash, result_json FROM mutation_requests WHERE actor_kind = 'human' AND actor_id = ? AND action = ? AND request_key = ?",
    [userId, action, requestKey],
  );
  if (!existing) return null;
  if (text(existing.body_hash) !== bodyHash) throw conflict("IDEMPOTENCY_CONFLICT", "That idempotency key was already used for different terms.");
  return JSON.parse(text(existing.result_json));
}

function storeReplay(db: DatabaseSync, workspaceId: string, userId: string, action: string, requestKey: string | undefined, bodyHash: string, result: unknown, now: number) {
  if (!requestKey) return;
  run(
    db,
    `INSERT INTO mutation_requests (id, workspace_id, actor_kind, actor_id, action, request_key, body_hash, result_json, created_at)
     VALUES (?, ?, 'human', ?, ?, ?, ?, ?, ?)`,
    [id(), workspaceId, userId, action, requestKey, bodyHash, JSON.stringify(result), now],
  );
}

function sumAmounts(db: DatabaseSync, sql: string, params: SQLInputValue[]): number {
  return rows(db, sql, params).reduce((total, item) => total + num(item.amount_cents), 0);
}

function safeFreshness(): number {
  try {
    return getEnv().BANK_FRESHNESS_SECONDS * 1000;
  } catch {
    return 60_000;
  }
}

function safeLeaseSeconds(): number {
  try {
    return getEnv().TASK_LEASE_SECONDS;
  } catch {
    return 300;
  }
}

function sanitizeEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeEvidence);
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 500) : value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    if (/token|secret|password|key/i.test(key)) continue;
    output[key] = typeof item === "string" ? item.slice(0, 500) : item;
  }
  return output;
}

export function markToolsVerified(db: DatabaseSync, connectionId: string, now: number) {
  const connection = row(db, "SELECT workspace_id, tools_verified_at FROM connections WHERE id = ?", [connectionId]);
  if (!connection) return;
  run(db, "UPDATE connections SET tools_verified_at = COALESCE(tools_verified_at, ?), last_seen_at = ? WHERE id = ?", [now, now, connectionId]);
  if (!connection.tools_verified_at) {
    audit(db, {
      workspaceId: text(connection.workspace_id),
      actorKind: "connector",
      connectionId,
      eventType: "TOOLS_VERIFIED",
      subjectType: "connection",
      subjectId: connectionId,
      detail: {},
      at: now,
    });
  }
}
