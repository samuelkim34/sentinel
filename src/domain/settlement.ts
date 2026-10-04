import type { DatabaseSync } from "node:sqlite";
import { conflict, invalid } from "../contracts/errors";
import { getEnv } from "../server/env";
import { getBankingAdapter } from "../banking/adapter";
import { BankOperationError, type PurchaseReceipt } from "../banking/types";
import { atomic, num, row, run, text, type SqlRow } from "../storage/sql";
import { audit, requireHuman, type HumanContext } from "./access";
import { applyObservation } from "./accounts";
import { id } from "./ids";
import { recheckExistingReservation } from "./proposals";

const inFlight = new Set<string>();

export async function runWorkerCycle(db: DatabaseSync, now = Date.now()): Promise<void> {
  heartbeat(db, now);
  recoverSubmitting(db, now);
  recoverClaimedJobs(db, now);
  expireMandates(db, now);
  releaseExpiredLeases(db, now);
  expireVoice(db, now);
  const job = claimJob(db, now);
  if (!job) return;
  try {
    if (job.kind === "payment") await submitPayment(db, job.subjectId, now);
    else if (job.kind === "reconcile") await reconcilePayment(db, job.subjectId, now);
    finishJob(db, job.id);
  } catch (error) {
    const code = error instanceof BankOperationError ? error.kind : "WORKER_ERROR";
    run(db, "UPDATE jobs SET state = 'DUE', run_after = ?, attempt_count = attempt_count + 1, error_code = ? WHERE id = ?", [
      now + 5000, code, job.id,
    ]);
  }
}

export function recoverSubmitting(db: DatabaseSync, now: number): void {
  const stuck = rowsSafe(db, "SELECT id, proposal_id FROM payment_operations WHERE state = 'SUBMITTING' AND submitted_at <= ?", [now - 120_000]);
  for (const operation of stuck) {
    if (inFlight.has(text(operation.id))) continue;
    atomic(db, () => moveToReconcile(db, text(operation.proposal_id), text(operation.id), now, "RECOVERED_AFTER_INTERRUPTION"));
  }
}

export async function submitPayment(db: DatabaseSync, proposalId: string, now: number): Promise<void> {
  const proposal = row(db, "SELECT * FROM proposals WHERE id = ?", [proposalId]);
  if (!proposal || text(proposal.state) !== "RESERVED") return;
  const wallet = row(db, "SELECT * FROM wallets WHERE id = ?", [text(proposal.wallet_id)]);
  if (!wallet) return;
  const freshness = getEnv().BANK_FRESHNESS_SECONDS * 1000;
  if (now - num(wallet.last_verified_at) > freshness) {
    try {
      const account = await getBankingAdapter().getAccount(text(wallet.upstream_account_id));
      if (account.externalId !== text(wallet.upstream_account_id) || account.customerExternalId !== text(wallet.upstream_customer_id)) {
        throw new BankOperationError("INVALID_RESPONSE", "The bank returned a different account.");
      }
      const version = num(wallet.version);
      atomic(db, () => {
        const current = row(db, "SELECT version FROM wallets WHERE id = ?", [text(wallet.id)]);
        if (!current || num(current.version) !== version) throw conflict("WALLET_VERSION", "The account changed during refresh.");
        applyObservation(db, text(proposal.workspace_id), text(wallet.id), account.balanceCents, account.observedAt, account.responseId, null);
      });
    } catch {
      throw new BankOperationError("UNAVAILABLE", "A fresh account read is required before submission.");
    }
  }
  const operationId = id();
  const reference = `sentinel-${operationId}`;
  const claimed = atomic(db, () => {
    const current = row(db, "SELECT * FROM proposals WHERE id = ?", [proposalId]);
    if (!current || text(current.state) !== "RESERVED") return false;
    // Include time spent waiting for the provider; expiry must be checked at submission.
    const submissionNow = Math.max(now, Date.now());
    const decision = recheckExistingReservation(db, proposalId, submissionNow);
    if (decision.outcome === "BLOCKED") {
      run(db, "DELETE FROM reservations WHERE proposal_id = ?", [proposalId]);
      run(db, "UPDATE proposals SET state = 'BLOCKED', decision_codes = ?, explanation = ?, updated_at = ? WHERE id = ?", [
        JSON.stringify(decision.codes), decision.explanation, now, proposalId,
      ]);
      run(db, "UPDATE tasks SET state = 'BLOCKED', updated_at = ? WHERE id = ?", [now, text(current.task_id)]);
      audit(db, { workspaceId: text(current.workspace_id), actorKind: "worker", eventType: "PROPOSAL_BLOCKED", subjectType: "proposal", subjectId: proposalId, detail: { codes: decision.codes }, at: submissionNow });
      return false;
    }
    const unresolved = row(
      db,
      "SELECT id FROM payment_operations WHERE wallet_id = ? AND state IN ('SUBMITTING','SUBMITTED_PENDING','RECONCILE_REQUIRED')",
      [text(current.wallet_id)],
    );
    if (unresolved) throw conflict("WALLET_BUSY", "This account already has an unresolved submission.");
    run(
      db,
      `INSERT INTO payment_operations (
        id, proposal_id, wallet_id, upstream_reference, state, submission_count, submitted_at, attempt_count
      ) VALUES (?, ?, ?, ?, 'SUBMITTING', 1, ?, 0)`,
      [operationId, proposalId, text(current.wallet_id), reference, now],
    );
    run(db, "UPDATE proposals SET state = 'SUBMITTING', updated_at = ? WHERE id = ?", [now, proposalId]);
    run(db, "UPDATE tasks SET state = 'WAITING_PAYMENT', updated_at = ? WHERE id = ?", [now, text(current.task_id)]);
    audit(db, {
      workspaceId: text(current.workspace_id),
      actorKind: "worker",
      eventType: "PAYMENT_SUBMITTING",
      subjectType: "proposal",
      subjectId: proposalId,
      detail: { reference },
      at: now,
    });
    return true;
  });
  if (!claimed) return;
  inFlight.add(operationId);
  const merchant = row(db, "SELECT upstream_merchant_id FROM merchant_catalog WHERE id = ?", [text(proposal.merchant_id)]);
  try {
    const receipt = await getBankingAdapter().createPurchase({
      accountExternalId: text(wallet.upstream_account_id),
      merchantExternalId: merchant ? text(merchant.upstream_merchant_id) : "",
      amountCents: num(proposal.amount_cents),
      currency: "USD",
      sentinelReference: reference,
      description: reference,
    });
    atomic(db, () => applyReceipt(db, proposalId, operationId, receipt, now));
  } catch (error) {
    atomic(db, () => {
      if (error instanceof BankOperationError && error.kind === "REJECTED") {
        releaseAsFailed(db, proposalId, operationId, now, "UPSTREAM_REJECTED");
      } else {
        moveToReconcile(db, proposalId, operationId, now, error instanceof Error ? error.name : "UNKNOWN");
      }
    });
  } finally {
    inFlight.delete(operationId);
  }
}

export async function reconcilePayment(db: DatabaseSync, proposalId: string, now: number): Promise<void> {
  const operation = row(db, "SELECT * FROM payment_operations WHERE proposal_id = ?", [proposalId]);
  if (!operation) return;
  if (!["RECONCILE_REQUIRED", "SUBMITTED_PENDING", "SUBMITTING"].includes(text(operation.state))) return;
  const attempts = num(operation.attempt_count) + 1;
  const max = getEnv().RECONCILE_MAX_ATTEMPTS;
  const wallet = row(db, "SELECT upstream_account_id FROM wallets WHERE id = ?", [text(operation.wallet_id)]);
  let receipt: PurchaseReceipt | null = null;
  try {
    if (operation.upstream_id) receipt = await getBankingAdapter().getPurchase(text(operation.upstream_id));
    else if (wallet) {
      const lookup = await getBankingAdapter().findPurchaseByReference(text(wallet.upstream_account_id), text(operation.upstream_reference));
      if (!lookup.supported) receipt = null;
      else receipt = lookup.receipt;
    }
  } catch {
    receipt = null;
  }
  atomic(db, () => {
    const current = row(db, "SELECT * FROM payment_operations WHERE id = ?", [text(operation.id)]);
    if (!current || ["COMPLETED", "FAILED"].includes(text(current.state))) return;
    run(db, "UPDATE payment_operations SET attempt_count = ?, last_checked_at = ? WHERE id = ?", [attempts, now, text(operation.id)]);
    if (receipt && receiptMatches(db, proposalId, receipt, current)) {
      applyReceipt(db, proposalId, text(operation.id), receipt, now);
      return;
    }
    if (attempts >= max) {
      run(db, "UPDATE payment_operations SET attempt_count = ?, last_checked_at = ?, manual_review = 1, next_check_at = NULL WHERE id = ?", [
        attempts, now, text(operation.id),
      ]);
      run(db, "UPDATE jobs SET state = 'DONE' WHERE kind = 'reconcile' AND subject_id = ? AND state = 'DUE'", [proposalId]);
      return;
    }
    const delay = Math.min(60_000, 1000 * 2 ** attempts);
    run(db, "UPDATE payment_operations SET attempt_count = ?, last_checked_at = ?, next_check_at = ? WHERE id = ?", [
      attempts, now, now + delay, text(operation.id),
    ]);
    scheduleReconcile(db, proposalId, now + delay, attempts);
  });
}

export function applyReceipt(db: DatabaseSync, proposalId: string, operationId: string, receipt: PurchaseReceipt, now: number): void {
  const operation = row(db, "SELECT * FROM payment_operations WHERE id = ?", [operationId]);
  const proposal = row(db, "SELECT * FROM proposals WHERE id = ?", [proposalId]);
  if (!operation || !proposal || text(operation.proposal_id) !== proposalId) return;
  if (num(operation.receipt_applied) === 1 || text(operation.state) === "COMPLETED" || text(operation.state) === "FAILED") return;
  if (!receiptMatches(db, proposalId, receipt, operation)) {
    // An ID returned to our initial POST can be read back, but never proves settlement by itself.
    if (!operation.upstream_id && text(operation.state) === "SUBMITTING" && receipt.externalId && !receiptContradicts(db, proposalId, receipt, operation)) {
      run(db, "UPDATE payment_operations SET upstream_id = ? WHERE id = ?", [receipt.externalId, operationId]);
    }
    moveToReconcile(db, proposalId, operationId, now, "RECEIPT_NOT_VERIFIED");
    return;
  }
  if (receipt.state === "COMPLETED") {
    const wallet = row(db, "SELECT * FROM wallets WHERE id = ?", [text(proposal.wallet_id)])!;
    const nextBalance = Math.max(0, num(wallet.policy_balance_cents) - num(proposal.amount_cents));
    const short = num(wallet.policy_balance_cents) < num(proposal.amount_cents);
    run(db, "UPDATE wallets SET policy_balance_cents = ?, state = ?, quarantine_reason = ?, version = version + 1 WHERE id = ?", [
      nextBalance,
      short ? "QUARANTINED" : text(wallet.state),
      short ? "Completed debit exceeded the conservative balance." : wallet.quarantine_reason,
      text(wallet.id),
    ]);
    run(db, "DELETE FROM reservations WHERE proposal_id = ?", [proposalId]);
    run(db, "UPDATE proposals SET state = 'COMPLETED', updated_at = ? WHERE id = ?", [now, proposalId]);
    run(db, "UPDATE payment_operations SET state = 'COMPLETED', upstream_id = COALESCE(?, upstream_id), receipt_applied = 1, last_checked_at = ? WHERE id = ?", [
      receipt.externalId, now, operationId,
    ]);
    run(db, "UPDATE tasks SET state = 'COMPLETED', updated_at = ? WHERE id = ?", [now, text(proposal.task_id)]);
    run(db, "UPDATE payment_operations SET next_check_at = NULL, manual_review = 0 WHERE id = ?", [operationId]);
    run(db, "UPDATE jobs SET state = 'DONE' WHERE kind = 'reconcile' AND subject_id = ? AND state = 'DUE'", [proposalId]);
    audit(db, {
      workspaceId: text(proposal.workspace_id),
      actorKind: "worker",
      eventType: "PAYMENT_COMPLETED",
      subjectType: "proposal",
      subjectId: proposalId,
      detail: { upstreamId: receipt.externalId, amountCents: num(proposal.amount_cents) },
      at: now,
    });
    return;
  }
  if (receipt.state === "REJECTED") {
    releaseAsFailed(db, proposalId, operationId, now, "UPSTREAM_REJECTED");
    return;
  }
  if (receipt.state === "PENDING") {
    run(db, "UPDATE proposals SET state = 'SUBMITTED_PENDING', updated_at = ? WHERE id = ?", [now, proposalId]);
    run(db, "UPDATE payment_operations SET state = 'SUBMITTED_PENDING', upstream_id = COALESCE(?, upstream_id), last_checked_at = ? WHERE id = ?", [
      receipt.externalId, now, operationId,
    ]);
    run(db, "UPDATE tasks SET state = 'WAITING_PAYMENT', updated_at = ? WHERE id = ?", [now, text(proposal.task_id)]);
    audit(db, {
      workspaceId: text(proposal.workspace_id),
      actorKind: "worker",
      eventType: "PAYMENT_PENDING",
      subjectType: "proposal",
      subjectId: proposalId,
      detail: { upstreamId: receipt.externalId },
      at: now,
    });
    const attempts = num(operation.attempt_count);
    if (attempts >= getEnv().RECONCILE_MAX_ATTEMPTS) {
      run(db, "UPDATE payment_operations SET manual_review = 1, next_check_at = NULL WHERE id = ?", [operationId]);
      run(db, "UPDATE jobs SET state = 'DONE' WHERE kind = 'reconcile' AND subject_id = ? AND state = 'DUE'", [proposalId]);
    } else {
      const next = now + Math.min(60_000, Math.max(5000, 1000 * 2 ** attempts));
      run(db, "UPDATE payment_operations SET next_check_at = ? WHERE id = ?", [next, operationId]);
      scheduleReconcile(db, proposalId, next, attempts);
    }
    return;
  }
  moveToReconcile(db, proposalId, operationId, now, "UNKNOWN_RECEIPT");
  if (receipt.externalId) {
    run(db, "UPDATE payment_operations SET upstream_id = COALESCE(upstream_id, ?) WHERE id = ?", [receipt.externalId, operationId]);
  }
}

export function queueReconcile(db: DatabaseSync, human: HumanContext, proposalId: string, now: number) {
  return atomic(db, () => {
  const member = requireHuman(db, human);
  const proposal = row(db, "SELECT * FROM proposals WHERE id = ? AND workspace_id = ?", [proposalId, human.workspaceId]);
  if (!proposal) throw invalid("PROPOSAL_MISSING", "That proposal is not available.");
  if (!["RECONCILE_REQUIRED", "SUBMITTED_PENDING", "SUBMITTING"].includes(text(proposal.state))) {
    throw conflict("NOT_RECONCILABLE", "This proposal has no uncertain banking submission to read.");
  }
  if (member.role === "member") throw conflict("RECONCILE_FORBIDDEN", "Only an owner or finance user can queue reconciliation.");
  run(db, "UPDATE payment_operations SET manual_review = 0, attempt_count = 0, next_check_at = ? WHERE proposal_id = ?", [now, proposalId]);
  scheduleReconcile(db, proposalId, now, 0);
  return { proposalId, queued: true };
  });
}

function moveToReconcile(db: DatabaseSync, proposalId: string, operationId: string, now: number, detail: string) {
  const proposal = row(db, "SELECT workspace_id, task_id, state FROM proposals WHERE id = ?", [proposalId]);
  if (!proposal) return;
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(text(proposal.state))) return;
  run(db, "UPDATE proposals SET state = 'RECONCILE_REQUIRED', updated_at = ? WHERE id = ?", [now, proposalId]);
  run(db, "UPDATE payment_operations SET state = 'RECONCILE_REQUIRED', detail = ?, last_checked_at = ? WHERE id = ? AND receipt_applied = 0", [
    detail, now, operationId,
  ]);
  run(db, "UPDATE tasks SET state = 'NEEDS_RECONCILIATION', updated_at = ? WHERE id = ?", [now, text(proposal.task_id)]);
  audit(db, {
    workspaceId: text(proposal.workspace_id),
    actorKind: "worker",
    eventType: "RECONCILIATION_REQUIRED",
    subjectType: "proposal",
    subjectId: proposalId,
    detail: { detail },
    at: now,
  });
  const operation = row(db, "SELECT attempt_count FROM payment_operations WHERE id = ?", [operationId]);
  if (num(operation?.attempt_count) >= getEnv().RECONCILE_MAX_ATTEMPTS) {
    run(db, "UPDATE payment_operations SET manual_review = 1, next_check_at = NULL WHERE id = ?", [operationId]);
    run(db, "UPDATE jobs SET state = 'DONE' WHERE kind = 'reconcile' AND subject_id = ? AND state = 'DUE'", [proposalId]);
  } else scheduleReconcile(db, proposalId, now + 5000, num(operation?.attempt_count));
}

function releaseAsFailed(db: DatabaseSync, proposalId: string, operationId: string, now: number, code: string) {
  const proposal = row(db, "SELECT * FROM proposals WHERE id = ?", [proposalId]);
  if (!proposal) return;
  if (num(row(db, "SELECT receipt_applied FROM payment_operations WHERE id = ?", [operationId])?.receipt_applied) === 1) return;
  run(db, "DELETE FROM reservations WHERE proposal_id = ?", [proposalId]);
  run(db, "UPDATE proposals SET state = 'FAILED', decision_codes = ?, explanation = ?, updated_at = ? WHERE id = ?", [
    JSON.stringify([code]), "The bank rejected the purchase and no debit was verified.", now, proposalId,
  ]);
  run(db, "UPDATE payment_operations SET state = 'FAILED', receipt_applied = 1, detail = ?, last_checked_at = ? WHERE id = ?", [code, now, operationId]);
  run(db, "UPDATE tasks SET state = 'BLOCKED', updated_at = ? WHERE id = ?", [now, text(proposal.task_id)]);
  audit(db, {
    workspaceId: text(proposal.workspace_id),
    actorKind: "worker",
    eventType: "PROPOSAL_BLOCKED",
    subjectType: "proposal",
    subjectId: proposalId,
    detail: { code },
    at: now,
  });
}

function receiptContradicts(db: DatabaseSync, proposalId: string, receipt: PurchaseReceipt, operation: SqlRow): boolean {
  const proposal = row(db, "SELECT amount_cents, merchant_id, wallet_id FROM proposals WHERE id = ?", [proposalId]);
  if (!proposal) return true;
  if (receipt.amountCents !== null && receipt.amountCents !== num(proposal.amount_cents)) return true;
  if (operation.upstream_id && receipt.externalId !== text(operation.upstream_id)) return true;
  if (receipt.reference !== null && receipt.reference !== text(operation.upstream_reference)) return true;
  if (receipt.merchantExternalId) {
    const merchant = row(db, "SELECT upstream_merchant_id FROM merchant_catalog WHERE id = ?", [text(proposal.merchant_id)]);
    if (!merchant || text(merchant.upstream_merchant_id) !== receipt.merchantExternalId) return true;
  }
  if (receipt.accountExternalId) {
    const wallet = row(db, "SELECT upstream_account_id FROM wallets WHERE id = ?", [text(proposal.wallet_id)]);
    if (!wallet || text(wallet.upstream_account_id) !== receipt.accountExternalId) return true;
  }
  return false;
}

function receiptMatches(db: DatabaseSync, proposalId: string, receipt: PurchaseReceipt, operation: SqlRow): boolean {
  if (receiptContradicts(db, proposalId, receipt, operation)) return false;
  if (!receipt.externalId || receipt.amountCents === null || !receipt.merchantExternalId || !receipt.accountExternalId) return false;
  return Boolean(operation.upstream_id || receipt.reference === text(operation.upstream_reference) || text(operation.state) === "SUBMITTING");
}

function scheduleReconcile(db: DatabaseSync, proposalId: string, runAfter: number, attempts: number) {
  const existing = row(db, "SELECT id FROM jobs WHERE kind = 'reconcile' AND subject_id = ? AND state = 'DUE'", [proposalId]);
  if (existing) run(db, "UPDATE jobs SET run_after = MIN(run_after, ?) WHERE id = ?", [runAfter, text(existing.id)]);
  else run(db, "INSERT INTO jobs (id, kind, subject_id, state, run_after, attempt_count) VALUES (?, 'reconcile', ?, 'DUE', ?, ?)", [id(), proposalId, runAfter, attempts]);
}

export function recoverClaimedJobs(db: DatabaseSync, now: number) {
  atomic(db, () => {
    for (const job of rowsSafe(db, "SELECT * FROM jobs WHERE state = 'CLAIMED' AND claimed_at <= ?", [now - 120_000])) {
      const operation = row(db, "SELECT state FROM payment_operations WHERE proposal_id = ?", [text(job.subject_id)]);
      const canRetry = text(job.kind) === "reconcile" || !operation;
      run(db, "UPDATE jobs SET state = ?, run_after = ?, claimed_at = NULL, claim_token = NULL WHERE id = ?", [canRetry ? "DUE" : "DONE", now, text(job.id)]);
    }
  });
}

function claimJob(db: DatabaseSync, now: number): { id: string; kind: string; subjectId: string } | null {
  return atomic(db, () => {
    const job = row(db, "SELECT id, kind, subject_id FROM jobs WHERE state = 'DUE' AND run_after <= ? ORDER BY run_after, id LIMIT 1", [now]);
    if (!job) return null;
    const token = id();
    const changes = run(db, "UPDATE jobs SET state = 'CLAIMED', claimed_at = ?, claim_token = ? WHERE id = ? AND state = 'DUE'", [now, token, text(job.id)]);
    if (changes !== 1) return null;
    return { id: text(job.id), kind: text(job.kind), subjectId: text(job.subject_id) };
  });
}

function finishJob(db: DatabaseSync, jobId: string) {
  run(db, "UPDATE jobs SET state = 'DONE' WHERE id = ? AND state = 'CLAIMED'", [jobId]);
}

function heartbeat(db: DatabaseSync, now: number) {
  run(db, "INSERT INTO worker_status (id, last_seen_at, pid) VALUES ('primary', ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, pid = excluded.pid", [
    now, process.pid,
  ]);
}

function expireMandates(db: DatabaseSync, now: number) {
  const mandates = rowsSafe(db, "SELECT id, workspace_id FROM mandates WHERE state = 'ACTIVE' AND expires_at <= ?", [now]);
  for (const mandate of mandates) {
    atomic(db, () => {
      run(db, "UPDATE mandates SET state = 'EXPIRED' WHERE id = ? AND state = 'ACTIVE'", [text(mandate.id)]);
      const proposals = rowsSafe(db, "SELECT id, task_id FROM proposals WHERE mandate_id = ? AND state IN ('RESERVED','REVIEW_REQUIRED')", [text(mandate.id)]);
      for (const proposal of proposals) {
        run(db, "DELETE FROM reservations WHERE proposal_id = ?", [text(proposal.id)]);
        run(db, "UPDATE proposals SET state = 'CANCELLED', cancel_reason = 'MANDATE_EXPIRED', updated_at = ? WHERE id = ?", [now, text(proposal.id)]);
        run(db, "UPDATE tasks SET state = 'BLOCKED', version = version + 1, updated_at = ? WHERE id = ?", [now, text(proposal.task_id)]);
        run(db, "DELETE FROM task_leases WHERE task_id = ?", [text(proposal.task_id)]);
        run(db, "UPDATE jobs SET state = 'FAILED', error_code = 'MANDATE_EXPIRED' WHERE kind = 'payment' AND subject_id = ? AND state = 'DUE'", [text(proposal.id)]);
      }
      audit(db, {
        workspaceId: text(mandate.workspace_id),
        actorKind: "worker",
        eventType: "MANDATE_REVOKED",
        subjectType: "mandate",
        subjectId: text(mandate.id),
        detail: { reason: "EXPIRED" },
        at: now,
      });
    });
  }
}

function releaseExpiredLeases(db: DatabaseSync, now: number) {
  const leases = rowsSafe(db, "SELECT task_id FROM task_leases WHERE expires_at <= ?", [now]);
  for (const lease of leases) {
    const proposal = row(
      db,
      "SELECT id FROM proposals WHERE task_id = ? AND state IN ('RESERVED','SUBMITTING','SUBMITTED_PENDING','RECONCILE_REQUIRED','COMPLETED','REVIEW_REQUIRED')",
      [text(lease.task_id)],
    );
    if (proposal) continue;
    const task = row(db, "SELECT state FROM tasks WHERE id = ?", [text(lease.task_id)]);
    if (task && text(task.state) === "IN_PROGRESS") {
      run(db, "UPDATE tasks SET state = 'QUEUED', updated_at = ? WHERE id = ?", [now, text(lease.task_id)]);
    }
    run(db, "DELETE FROM task_leases WHERE task_id = ?", [text(lease.task_id)]);
  }
}

function expireVoice(db: DatabaseSync, now: number) {
  run(db, "UPDATE voice_sessions SET state = 'EXPIRED', ended_at = ? WHERE state = 'ACTIVE' AND expires_at <= ?", [now, now]);
  run(db, "UPDATE authority_drafts SET state = 'EXPIRED' WHERE state = 'PENDING' AND expires_at <= ?", [now]);
  run(db, "DELETE FROM rate_events WHERE created_at < ?", [now - 86_400_000]);
  run(db, "DELETE FROM reauth_grants WHERE expires_at <= ?", [now]);
}

function rowsSafe(db: DatabaseSync, sql: string, params: Array<string | number> = []) {
  return db.prepare(sql).all(...params) as Array<Record<string, string | number | bigint | null>>;
}
