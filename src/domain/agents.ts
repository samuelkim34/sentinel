import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CONNECTOR_SCOPES } from '../contracts/constants';
import { AppError, conflict, forbidden, unavailable } from '../contracts/errors';
import { getEnv } from '../server/env';
import { atomic, num, row, rows, run, text, type SqlRow } from '../storage/sql';
import { audit, requireHuman, requireActiveMember, rememberMutation, storeMutation, type HumanContext, type ConnectorContext } from './access';
import { createRegistration, getRegistration, updateRegistration } from './authority';
import { canonicalHash, id } from './ids';
import { requireWorkspace } from './workspaces';

const profileSchema = z.object({ name: z.string().trim().min(1).max(80), purpose: z.string().trim().min(1).max(500), instructions: z.string().trim().max(4000).default(''), walletIds: z.array(z.string().min(1)).max(50).default([]) }).strict();
export type AgentInput = z.input<typeof profileSchema>;

export function controllableAgent(db: DatabaseSync, human: HumanContext, registrationId: string) {
  requireHuman(db, human);
  const registration = getRegistration(db, human, registrationId);
  if (human.role !== 'owner' && registration.controllerUserId !== human.userId) throw forbidden('Only this agent’s controller or an owner can configure it or chat with it.', 'AGENT_FORBIDDEN');
  if (registration.state === 'ARCHIVED') throw conflict('REGISTRATION_ARCHIVED', 'This agent is archived.');
  return registration;
}

function installProfile(db: DatabaseSync, human: HumanContext, registrationId: string, instructions: string, now: number) {
  const registration = controllableAgent(db, human, registrationId);
  const connectionId = id();
  run(db, `INSERT INTO connections (id, workspace_id, registration_id, user_id, resource_uri, auth_mode, state, scopes, created_at)
    VALUES (?, ?, ?, ?, ?, 'INTERNAL', 'ACTIVE', ?, ?)`, [connectionId, human.workspaceId, registrationId, registration.controllerUserId, `urn:sentinel:agent:${registrationId}`, JSON.stringify(CONNECTOR_SCOPES), now]);
  run(db, 'INSERT INTO agent_profiles (registration_id, connection_id, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [registrationId, connectionId, instructions, now, now]);
  audit(db, { workspaceId: human.workspaceId, actorKind: 'human', actorUserId: human.userId, eventType: 'ONSITE_AGENT_ENABLED', subjectType: 'registration', subjectId: registrationId, detail: { connectionId }, at: now });
  return getRegistration(db, human, registrationId);
}

export function createAgent(db: DatabaseSync, human: HumanContext, input: AgentInput, now: number, requestKey?: string) {
  const parsed = profileSchema.parse(input);
  return atomic(db, () => {
    requireHuman(db, human);
    const mutation = { actorKind: 'human', actorId: human.userId, action: 'create-agent', requestKey: requestKey ?? '', bodyHash: canonicalHash({ ...parsed, workspaceId: human.workspaceId }), at: now, workspaceId: human.workspaceId };
    const replay = requestKey && rememberMutation(db, mutation).replay;
    if (replay) return getRegistration(db, human, String(JSON.parse(replay).id));
    if (num(row(db, "SELECT COUNT(*) AS c FROM registrations r JOIN agent_profiles p ON p.registration_id = r.id WHERE r.workspace_id = ? AND r.state != 'ARCHIVED'", [human.workspaceId])?.c) >= 20) throw conflict('AGENT_LIMIT', 'This workspace supports 20 active agents. Archive an unused one first.');
    const registration = createRegistration(db, human, parsed, now);
    const result = installProfile(db, human, registration.id, parsed.instructions, now);
    if (requestKey) storeMutation(db, { ...mutation, result: { id: result.id } });
    return result;
  });
}

export function enableOnsiteAgent(db: DatabaseSync, human: HumanContext, registrationId: string, instructions: string, now: number) {
  const parsed = z.string().trim().max(4000).parse(instructions);
  return atomic(db, () => {
    controllableAgent(db, human, registrationId);
    if (row(db, 'SELECT registration_id FROM agent_profiles WHERE registration_id = ?', [registrationId])) return getRegistration(db, human, registrationId);
    if (row(db, `SELECT l.task_id FROM task_leases l JOIN tasks t ON t.id = l.task_id WHERE t.registration_id = ? AND l.expires_at > ?`, [registrationId, now]) || row(db, "SELECT id FROM proposals WHERE registration_id = ? AND state IN ('REVIEW_REQUIRED','RESERVED','SUBMITTING','SUBMITTED_PENDING','RECONCILE_REQUIRED')", [registrationId])) throw conflict('AGENT_WORK_PENDING', 'Finish or cancel existing external work before enabling this agent on-site.');
    run(db, "UPDATE connections SET state = 'REVOKED', token_hash = NULL WHERE registration_id = ?", [registrationId]);
    run(db, 'DELETE FROM task_leases WHERE task_id IN (SELECT id FROM tasks WHERE registration_id = ?)', [registrationId]);
    return installProfile(db, human, registrationId, parsed, now);
  });
}

export function updateAgent(db: DatabaseSync, human: HumanContext, registrationId: string, input: AgentInput & { expectedVersion: number }, now: number) {
  const { expectedVersion, ...fields } = input;
  const parsed = profileSchema.parse(fields);
  return atomic(db, () => {
    controllableAgent(db, human, registrationId);
    if (!row(db, 'SELECT registration_id FROM agent_profiles WHERE registration_id = ?', [registrationId])) throw conflict('AGENT_NOT_ENABLED', 'Enable the agent on-site first.');
    const current = rows(db, "SELECT wallet_id FROM read_grants WHERE registration_id = ? AND state = 'ACTIVE'", [registrationId]).map(g => text(g.wallet_id)).sort();
    const selected = [...new Set(parsed.walletIds)].sort();
    if (canonicalHash(current) !== canonicalHash(selected)) {
      if (human.role !== 'owner' && requireWorkspace(db, human.workspaceId).kind === 'BUSINESS') throw forbidden('Only an owner can change business account access.', 'READ_GRANT_FORBIDDEN');
      for (const walletId of selected) if (!row(db, 'SELECT id FROM wallets WHERE workspace_id = ? AND id = ?', [human.workspaceId, walletId])) throw conflict('WALLET_MISSING', 'Choose an account in this workspace.');
      const required = rows(db, "SELECT wallet_id FROM mandates WHERE registration_id = ? AND state = 'ACTIVE'", [registrationId]);
      if (required.some(m => !selected.includes(text(m.wallet_id)))) throw conflict('MANDATE_READ_GRANT', 'Revoke the allowance for an account before removing its read access.');
      run(db, "UPDATE read_grants SET state = 'REVOKED' WHERE registration_id = ?", [registrationId]);
      for (const walletId of selected) {
        const old = row(db, 'SELECT id FROM read_grants WHERE registration_id = ? AND wallet_id = ?', [registrationId, walletId]);
        if (old) run(db, "UPDATE read_grants SET state = 'ACTIVE', granted_by = ? WHERE id = ?", [human.userId, text(old.id)]);
        else run(db, "INSERT INTO read_grants (id, registration_id, wallet_id, granted_by, state) VALUES (?, ?, ?, ?, 'ACTIVE')", [id(), registrationId, walletId, human.userId]);
      }
    }
    updateRegistration(db, human, registrationId, { name: parsed.name, purpose: parsed.purpose, expectedVersion }, now);
    run(db, 'UPDATE agent_profiles SET instructions = ?, updated_at = ? WHERE registration_id = ?', [parsed.instructions, now, registrationId]);
    audit(db, { workspaceId: human.workspaceId, actorKind: 'human', actorUserId: human.userId, eventType: 'AGENT_CONFIGURED', subjectType: 'registration', subjectId: registrationId, detail: { walletIds: selected }, at: now });
    return getRegistration(db, human, registrationId);
  });
}

export function internalContext(db: DatabaseSync, registrationId: string): ConnectorContext {
  const found = row(db, `SELECT r.workspace_id, r.controller_user_id, r.state, p.connection_id, c.scopes, c.user_id FROM registrations r
    JOIN agent_profiles p ON p.registration_id = r.id JOIN connections c ON c.id = p.connection_id
    WHERE r.id = ? AND c.state = 'ACTIVE' AND c.auth_mode = 'INTERNAL' AND c.registration_id = r.id AND c.workspace_id = r.workspace_id`, [registrationId]);
  if (!found || text(found.state) !== 'ACTIVE' || text(found.user_id) !== text(found.controller_user_id)) throw forbidden('This agent is paused, archived, or disconnected.', 'AGENT_INACTIVE');
  requireActiveMember(db, text(found.workspace_id), text(found.controller_user_id));
  requireWorkspace(db, text(found.workspace_id));
  return { kind: 'connector', workspaceId: text(found.workspace_id), userId: text(found.controller_user_id), registrationId, connectionId: text(found.connection_id), scopes: new Set(JSON.parse(text(found.scopes))) };
}

export function runHuman(db: DatabaseSync, runRow: SqlRow): HumanContext {
  const registration = row(db, 'SELECT workspace_id FROM registrations WHERE id = ?', [text(runRow.registration_id)])!;
  const membership = requireActiveMember(db, text(registration.workspace_id), text(runRow.requester_user_id));
  const human: HumanContext = { kind: 'human', workspaceId: membership.workspaceId, userId: membership.userId, role: membership.role, sessionId: '' };
  controllableAgent(db, human, text(runRow.registration_id));
  return human;
}

export function agentRuntime(db: DatabaseSync, now = Date.now()) {
  const lastSeenAt = num(row(db, "SELECT last_seen_at FROM agent_worker_status WHERE id = 'primary'")?.last_seen_at) || null;
  return { configured: Boolean(getEnv().XAI_API_KEY), model: getEnv().XAI_AGENT_MODEL, workerOnline: lastSeenAt !== null && now - lastSeenAt < 20_000, lastSeenAt };
}

export function chatHistory(db: DatabaseSync, human: HumanContext, registrationId: string) {
  controllableAgent(db, human, registrationId);
  const conversation = row(db, 'SELECT id FROM agent_conversations WHERE registration_id = ? AND user_id = ?', [registrationId, human.userId]);
  const conversationId = conversation ? text(conversation.id) : '';
  const messages = rows(db, 'SELECT id, role, text, created_at FROM agent_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 100', [conversationId]).reverse().map(m => ({ id: num(m.id), role: text(m.role), text: text(m.text), createdAt: num(m.created_at) }));
  const runs = rows(db, 'SELECT * FROM agent_runs WHERE registration_id = ? AND (kind = \'TASK\' OR conversation_id = ?) ORDER BY created_at DESC, rowid DESC LIMIT 30', [registrationId, conversationId]).map(r => runDto(db, r));
  return { messages, runs, runtime: agentRuntime(db) };
}

function checkUsage(db: DatabaseSync, workspaceId: string, now: number) {
  if (num(row(db, 'SELECT COUNT(*) AS c FROM agent_runs ar JOIN registrations r ON r.id = ar.registration_id WHERE r.workspace_id = ? AND ar.created_at >= ?', [workspaceId, now - 86_400_000])?.c) >= getEnv().AGENT_DAILY_RUN_LIMIT) throw new AppError(429, 'AGENT_DAILY_LIMIT', 'The workspace’s daily agent run limit has been reached.');
}

export function sendChat(db: DatabaseSync, human: HumanContext, registrationId: string, input: { text: string; mandateId?: string | null }, now: number, requestKey?: string) {
  const parsed = z.object({ text: z.string().trim().min(1).max(4000), mandateId: z.string().max(100).nullish() }).strict().parse(input);
  return atomic(db, () => {
    const registration = controllableAgent(db, human, registrationId);
    internalContext(db, registrationId);
    const mutation = { actorKind: 'human', actorId: human.userId, action: 'agent-chat', requestKey: requestKey ?? '', bodyHash: canonicalHash({ registrationId, ...parsed }), at: now, workspaceId: human.workspaceId };
    const replay = requestKey && rememberMutation(db, mutation).replay;
    if (replay) return runDto(db, row(db, 'SELECT * FROM agent_runs WHERE id = ?', [String(JSON.parse(replay).id)])!);
    if (!getEnv().XAI_API_KEY) throw unavailable('AGENTS_NOT_CONFIGURED', 'The site operator must set XAI_API_KEY on the server to enable chat and task execution.');
    if (parsed.mandateId && !row(db, "SELECT id FROM mandates WHERE id = ? AND registration_id = ? AND workspace_id = ? AND controller_user_id = ? AND state = 'ACTIVE' AND expires_at > ?", [parsed.mandateId, registrationId, human.workspaceId, registration.controllerUserId, now])) throw conflict('MANDATE_MISSING', 'Choose a current allowance for this agent.');
    checkUsage(db, human.workspaceId, now);
    if (num(row(db, "SELECT COUNT(*) AS c FROM agent_runs WHERE requester_user_id = ? AND kind = 'CHAT' AND created_at >= ?", [human.userId, now - 60_000])?.c) >= 10 || num(row(db, "SELECT COUNT(*) AS c FROM agent_runs WHERE registration_id = ? AND state IN ('QUEUED','RUNNING')", [registrationId])?.c) >= 20) throw new AppError(429, 'AGENT_QUEUE_LIMIT', 'The agent has too many requests. Wait for the current work to finish.');
    let conversation = row(db, 'SELECT id FROM agent_conversations WHERE registration_id = ? AND user_id = ?', [registrationId, human.userId]);
    if (!conversation) { const conversationId = id(); run(db, 'INSERT INTO agent_conversations (id, registration_id, user_id, created_at) VALUES (?, ?, ?, ?)', [conversationId, registrationId, human.userId, now]); conversation = { id: conversationId }; }
    const conversationId = text(conversation.id);
    run(db, "INSERT INTO agent_messages (conversation_id, role, text, created_at) VALUES (?, 'user', ?, ?)", [conversationId, parsed.text, now]);
    const messageId = num(row(db, 'SELECT last_insert_rowid() AS id')?.id);
    const runId = id();
    run(db, `INSERT INTO agent_runs (id, registration_id, requester_user_id, kind, conversation_id, message_id, selected_mandate_id, state, model, created_at)
      VALUES (?, ?, ?, 'CHAT', ?, ?, ?, 'QUEUED', ?, ?)`, [runId, registrationId, human.userId, conversationId, messageId, parsed.mandateId ?? null, getEnv().XAI_AGENT_MODEL, now]);
    if (requestKey) storeMutation(db, { ...mutation, result: { id: runId } });
    return runDto(db, row(db, 'SELECT * FROM agent_runs WHERE id = ?', [runId])!);
  });
}

export function retryAgentRun(db: DatabaseSync, human: HumanContext, registrationId: string, runId: string, now: number) {
  return atomic(db, () => {
    controllableAgent(db, human, registrationId); internalContext(db, registrationId);
    if (!getEnv().XAI_API_KEY) throw unavailable('AGENTS_NOT_CONFIGURED', 'Configure XAI_API_KEY before retrying.');
    const old = row(db, 'SELECT * FROM agent_runs WHERE id = ? AND registration_id = ?', [runId, registrationId]);
    if (!old || text(old.state) !== 'FAILED' || (text(old.kind) === 'CHAT' && text(old.requester_user_id) !== human.userId)) throw conflict('RUN_NOT_RETRYABLE', 'Only failed runs visible to you can be retried.');
    if (row(db, "SELECT id FROM agent_runs WHERE registration_id = ? AND state IN ('QUEUED','RUNNING')", [registrationId])) throw conflict('AGENT_BUSY', 'Wait for current agent requests to finish before retrying.');
    if (old.task_id) {
      const task = row(db, 'SELECT state FROM tasks WHERE id = ?', [text(old.task_id)]);
      if (!task || !['QUEUED','IN_PROGRESS'].includes(text(task.state)) || row(db, "SELECT id FROM proposals WHERE task_id = ? AND state IN ('REVIEW_REQUIRED','RESERVED','SUBMITTING','SUBMITTED_PENDING','RECONCILE_REQUIRED','COMPLETED')", [text(old.task_id)])) throw conflict('TASK_NOT_RETRYABLE', 'This task has a proposal or has ended. Review its activity instead.');
    }
    checkUsage(db, human.workspaceId, now);
    const newId = id();
    run(db, `INSERT INTO agent_runs (id, registration_id, requester_user_id, kind, conversation_id, message_id, task_id, selected_mandate_id, state, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)`, [newId, registrationId, human.userId, text(old.kind), old.conversation_id ?? null, old.message_id ?? null, old.task_id ?? null, old.selected_mandate_id ?? null, getEnv().XAI_AGENT_MODEL, now]);
    audit(db, { workspaceId: human.workspaceId, actorKind: 'human', actorUserId: human.userId, eventType: 'AGENT_RUN_RETRIED', subjectType: 'agent_run', subjectId: newId, detail: { previousRunId: runId }, at: now });
    return runDto(db, row(db, 'SELECT * FROM agent_runs WHERE id = ?', [newId])!);
  });
}

export function scheduleAgentTasks(db: DatabaseSync, now: number) {
  if (!getEnv().XAI_API_KEY) return;
  atomic(db, () => {
    for (const task of rows(db, `SELECT t.*, p.execution_epoch FROM tasks t JOIN agent_profiles p ON p.registration_id = t.registration_id JOIN registrations r ON r.id = t.registration_id
      WHERE r.state = 'ACTIVE' AND t.state IN ('QUEUED','IN_PROGRESS','WAITING_APPROVAL','BLOCKED') AND NOT EXISTS (SELECT 1 FROM agent_runs ar WHERE ar.task_id = t.id AND ar.state IN ('QUEUED','RUNNING')) ORDER BY t.created_at LIMIT 50`)) {
      const instructions = rows(db, 'SELECT id FROM instructions WHERE task_id = ? ORDER BY created_at, id', [text(task.id)]).map(i => text(i.id));
      const pendingInstruction = row(db, "SELECT id FROM instructions WHERE task_id = ? AND state IN ('QUEUED','ACKNOWLEDGED')", [text(task.id)]);
      if (['WAITING_APPROVAL','BLOCKED'].includes(text(task.state)) && !pendingInstruction) continue;
      if (text(task.state) === 'IN_PROGRESS' && row(db, "SELECT id FROM agent_runs WHERE task_id = ? AND kind = 'TASK'", [text(task.id)]) && !pendingInstruction) continue;
      // All instruction IDs form an event watermark: acknowledging an instruction
      // does not accidentally create a second execution trigger.
      const triggerKey = `task:${text(task.id)}:${num(task.execution_epoch)}:${canonicalHash(instructions)}`;
      if (row(db, 'SELECT id FROM agent_runs WHERE trigger_key = ?', [triggerKey])) continue;
      try { internalContext(db, text(task.registration_id)); checkUsage(db, text(task.workspace_id), now); }
      catch (error) { if (error instanceof AppError) continue; throw error; }
      const runId = id();
      run(db, `INSERT INTO agent_runs (id, registration_id, requester_user_id, kind, task_id, trigger_key, state, model, created_at)
        VALUES (?, ?, ?, 'TASK', ?, ?, 'QUEUED', ?, ?)`, [runId, text(task.registration_id), text(task.controller_user_id), text(task.id), triggerKey, getEnv().XAI_AGENT_MODEL, now]);
    }
  });
}

function runDto(db: DatabaseSync, r: SqlRow) {
  return { id: text(r.id), kind: text(r.kind), state: text(r.state), taskId: r.task_id ? text(r.task_id) : null, model: text(r.model), steps: num(r.steps), summary: r.summary ? text(r.summary) : null, errorCode: r.error_code ? text(r.error_code) : null, createdAt: num(r.created_at), finishedAt: r.finished_at ? num(r.finished_at) : null,
    tools: rows(db, 'SELECT name, is_error, created_at FROM agent_tool_calls WHERE run_id = ? ORDER BY rowid', [text(r.id)]).map(c => ({ name: text(c.name), error: Boolean(c.is_error), createdAt: num(c.created_at) })) };
}
