import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, human, testEnv, banking } from './support';
import { setBankingAdapterForTests } from '../src/banking/adapter';
import { createAgent, chatHistory, enableOnsiteAgent, internalContext, retryAgentRun, scheduleAgentTasks, sendChat, updateAgent } from '../src/domain/agents';
import { createConnection, getRegistration, pauseRegistration, resumeRegistration } from '../src/domain/authority';
import { claimTask, createTask, queueInstruction } from '../src/domain/proposals';
import { agentState } from '../src/domain/agent-state';
import { createVoiceSession } from '../src/domain/voice';
import { getEnv, resetEnvCache } from '../src/server/env';
import { recoverAgentRuns, runAgentCycle } from '../src/agents/runner';
import { executeAgentTool, agentTools } from '../src/agents/tools';
import { grokResponse, parseModelResponse, type ModelRequest } from '../src/agents/grok-client';
import { num, row, rows, run, text } from '../src/storage/sql';
import { migrateApplication } from '../src/storage/migrate';

const originalFetch = globalThis.fetch;
beforeEach(() => { testEnv(); process.env.XAI_API_KEY = 'test-only-never-sent-to-a-live-provider'; resetEnvCache(); });
afterEach(() => { globalThis.fetch = originalFetch; setBankingAdapterForTests(null); delete process.env.AGENT_MAX_STEPS; delete process.env.AGENT_MAX_TOOL_CALLS; delete process.env.AGENT_DAILY_RUN_LIMIT; });

function onsite(kind: 'PERSONAL' | 'BUSINESS' = 'PERSONAL') {
  const f = fixture(kind);
  enableOnsiteAgent(f.db, f.owner, f.registration.id, 'Explain account facts clearly.', f.now);
  return f;
}
function reply(message = 'I read the recorded facts.') { return parseModelResponse({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: message }] }] }); }
function calls(...items: Array<[string, Record<string, unknown>, string?]>) { return parseModelResponse({ status: 'completed', output: items.map(([name, args, callId], i) => ({ type: 'function_call', name, arguments: JSON.stringify(args), call_id: callId ?? `call-${i}` })) }); }
function toolRun(f: ReturnType<typeof onsite>, kind: 'CHAT' | 'TASK' = 'CHAT', taskId: string | null = null, mandateId: string | null = null) {
  let runId: string;
  if (kind === 'CHAT') runId = sendChat(f.db, f.owner, f.registration.id, { text: 'Test a scoped action.', mandateId }, f.now).id;
  else {
    scheduleAgentTasks(f.db, f.now); runId = text(row(f.db, 'SELECT id FROM agent_runs WHERE task_id = ?', [taskId])?.id);
  }
  run(f.db, "UPDATE agent_runs SET state = 'RUNNING', claim_token = 'claim', claimed_until = ? WHERE id = ?", [Date.now() + 60_000, runId]);
  return (name: string, args: Record<string, unknown>, callId = 'tool', binding: Parameters<typeof executeAgentTool>[4] = null) => executeAgentTool(f.db, runId, 'claim', { type: 'function_call', call_id: callId, name, arguments: JSON.stringify(args) }, binding, Date.now()) as Record<string, unknown>;
}

test('agent creation persists configuration, replays requests and issues no external credential', () => {
  const f = fixture();
  const input = { name: 'My agent', purpose: 'My actual goal', instructions: 'Use short explanations.', walletIds: ['wallet'] };
  const a = createAgent(f.db, f.owner, input, f.now, 'create-1');
  assert.equal(a.executionMode, 'ONSITE'); assert.equal(a.agentReady, true); assert.equal(a.agentInstructions, input.instructions);
  assert.equal(a.setup.connectionId, null);
  const connection = row(f.db, 'SELECT c.* FROM connections c JOIN agent_profiles p ON p.connection_id = c.id WHERE p.registration_id = ?', [a.id])!;
  assert.equal(connection.auth_mode, 'INTERNAL'); assert.equal(connection.token_hash, null); assert.equal(connection.tools_verified_at, null);
  assert.equal(createAgent(f.db, f.owner, input, f.now, 'create-1').id, a.id);
  assert.throws(() => createAgent(f.db, f.owner, { ...input, name: 'Changed' }, f.now, 'create-1'), /different terms/);
  assert.throws(() => createConnection(f.db, f.owner, a.id, 'OAUTH', f.now), /already runs inside/);
  f.db.close();
});

test('business members cannot grant account access, edit another agent or read another conversation', () => {
  const f = onsite('BUSINESS');
  run(f.db, "INSERT INTO memberships (workspace_id, user_id, role, state, version, joined_at) VALUES (?, 'member', 'member', 'ACTIVE', 1, 1), (?, 'finance', 'finance', 'ACTIVE', 1, 1)", [f.workspace.id, f.workspace.id]);
  const member = human(f.workspace.id, 'member', 'member'); const finance = human(f.workspace.id, 'finance', 'finance');
  assert.throws(() => createAgent(f.db, member, { name: 'Blocked', purpose: 'No self grant', walletIds: ['wallet'] }, f.now), /owner grants account access/);
  const a = createAgent(f.db, member, { name: 'Member agent', purpose: 'Own work', walletIds: [] }, f.now);
  assert.throws(() => updateAgent(f.db, member, a.id, { name: a.name, purpose: a.purpose, walletIds: ['wallet'], expectedVersion: a.version }, f.now), /Only an owner/);
  assert.throws(() => chatHistory(f.db, member, f.registration.id));
  assert.throws(() => chatHistory(f.db, finance, f.registration.id), /controller or an owner/);
  f.db.close();
});

test('profiles use optimistic versions and reject removing account access under a live allowance', () => {
  const f = onsite(); const a = getRegistration(f.db, f.owner, f.registration.id);
  const input = { name: 'New name', purpose: a.purpose, instructions: 'Changed instructions', walletIds: ['wallet'], expectedVersion: a.version };
  const updated = updateAgent(f.db, f.owner, a.id, input, f.now);
  assert.equal(updated.name, 'New name'); assert.equal(updated.agentInstructions, 'Changed instructions');
  assert.throws(() => updateAgent(f.db, f.owner, a.id, input, f.now), /registration changed/);
  assert.throws(() => updateAgent(f.db, f.owner, a.id, { ...input, walletIds: [], expectedVersion: updated.version }, f.now), /Revoke the allowance/);
  assert.deepEqual(getRegistration(f.db, f.owner, a.id).grants.filter(g => g.state === 'ACTIVE').map(g => g.walletId), ['wallet']);
  f.db.close();
});

test('conversion refuses live external leases and financial commitments', () => {
  const f = fixture();
  const task = createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'RESEARCH', title: 'External task', requestedOutcome: 'Already running externally' }, f.now);
  claimTask(f.db, f.ctx, task.id, f.now);
  assert.throws(() => enableOnsiteAgent(f.db, f.owner, f.registration.id, '', f.now), /Finish or cancel/);
  run(f.db, 'DELETE FROM task_leases');
  f.purchase();
  assert.throws(() => enableOnsiteAgent(f.db, f.owner, f.registration.id, '', f.now), /Finish or cancel/);
  assert.equal(row(f.db, 'SELECT state FROM connections WHERE id = ?', [f.connection.id])?.state, 'ACTIVE'); f.db.close();
});

test('missing xAI configuration permits setup but rejects chat without inserting a message', () => {
  const f = onsite(); process.env.XAI_API_KEY = ''; resetEnvCache();
  assert.throws(() => sendChat(f.db, f.owner, f.registration.id, { text: 'Hello' }, f.now), /site operator/);
  assert.equal(num(row(f.db, 'SELECT COUNT(*) AS c FROM agent_messages')?.c), 0); f.db.close();
});

test('chat is durable and idempotent; controlled model outputs are paired with tool results', async () => {
  const f = onsite(); let count = 0; let secondInput: ModelRequest['input'] = [];
  const request = sendChat(f.db, f.owner, f.registration.id, { text: 'What accounts can you read?' }, f.now, 'message-1');
  assert.equal(sendChat(f.db, f.owner, f.registration.id, { text: 'What accounts can you read?' }, f.now, 'message-1').id, request.id);
  await runAgentCycle(f.db, async r => { count++; if (count === 1) return calls(['get_agent_state', {}, 'state-call']); secondInput = structuredClone(r.input); return reply('I can read Fixture account.'); });
  const history = chatHistory(f.db, f.owner, f.registration.id);
  assert.equal(history.messages.length, 2); assert.equal(history.messages[1].text, 'I can read Fixture account.'); assert.equal(history.runs[0].state, 'SUCCEEDED');
  assert(secondInput.some(i => i.type === 'function_call' && i.call_id === 'state-call'));
  assert(secondInput.some(i => i.type === 'function_call_output' && i.call_id === 'state-call'));
  assert.equal(history.runs[0].tools[0].name, 'get_agent_state'); f.db.close();
});

test('chat histories and voice state expose only the current user’s conversation', () => {
  const f = onsite('BUSINESS');
  run(f.db, "INSERT INTO memberships (workspace_id, user_id, role, state, version, joined_at) VALUES (?, 'owner2', 'owner', 'ACTIVE', 1, 1)", [f.workspace.id]);
  const second = human(f.workspace.id, 'owner2');
  sendChat(f.db, f.owner, f.registration.id, { text: 'Private owner text' }, f.now);
  sendChat(f.db, second, f.registration.id, { text: 'Private second text' }, f.now);
  assert.deepEqual(chatHistory(f.db, second, f.registration.id).messages.map(m => m.text), ['Private second text']);
  assert.deepEqual(agentState(f.db, f.owner, f.registration.id).recentChat.map(m => m.text), ['Private owner text']); f.db.close();
});

test('chat tool creation needs a human-selected current allowance and preserves the actual author', () => {
  const f = onsite('BUSINESS');
  const taskArgs = { kind: 'PURCHASE', title: 'Known purchase', requestedOutcome: 'Spend $15 at Fixture merchant' };
  const without = toolRun(f); const denied = without('create_task', taskArgs);
  assert.equal((denied.error as { code: string }).code, 'CHAT_PURCHASE_CONSENT'); assert.equal(num(row(f.db, 'SELECT COUNT(*) AS c FROM tasks')?.c), 0);
  run(f.db, "UPDATE agent_runs SET state = 'SUCCEEDED' WHERE state = 'RUNNING'");
  const withAllowance = toolRun(f, 'CHAT', null, f.mandate.id);
  const created = withAllowance('create_task', taskArgs);
  assert.equal(created.intentAuthorUserId, f.owner.userId);
  assert.equal(withAllowance('create_task', taskArgs, 'second-call').id, created.id);
  assert.equal(num(row(f.db, 'SELECT COUNT(*) AS c FROM tasks')?.c), 1);
  const changed = withAllowance('create_task', { ...taskArgs, title: 'Different task' }, 'changed-call');
  assert.equal((changed.error as { code: string }).code, 'IDEMPOTENCY_CONFLICT'); f.db.close();
});

test('tools reject cross-agent tasks, unknown tools and injected identity fields', () => {
  const f = onsite(); const other = createAgent(f.db, f.owner, { name: 'Other', purpose: 'Other agent', walletIds: [] }, f.now);
  const task = createTask(f.db, f.owner, { registrationId: other.id, kind: 'RESEARCH', title: 'Other work', requestedOutcome: 'Outside the agent' }, f.now);
  const tool = toolRun(f);
  assert.equal((tool('get_task', { taskId: task.id }).error as { code: string }).code, 'TASK_BINDING');
  assert.equal((tool('execute_payment', {}, 'forbidden').error as { code: string }).code, 'AGENT_TOOL_FORBIDDEN');
  assert.equal((tool('create_task', { kind: 'RESEARCH', title: 'Injection', requestedOutcome: 'Wrong identity', registrationId: other.id }, 'injected').error as { code: string }).code, 'INVALID_TOOL_ARGUMENTS');
  assert.equal(num(row(f.db, 'SELECT COUNT(*) AS c FROM tasks')?.c), 1);
  for (const kind of ['CHAT','TASK']) for (const t of agentTools(kind)) assert(!['approve_purchase','raise_budget','execute_payment','run_sql','arbitrary_fetch'].includes(String(t.name)));
  f.db.close();
});

test('tool journaling replays calls and rolls back domain writes if the journal fails', () => {
  const f = onsite(); const tool = toolRun(f); const args = { kind: 'RESEARCH', title: 'Once', requestedOutcome: 'One durable task' };
  const first = tool('create_task', args); assert.equal(tool('create_task', args).id, first.id);
  assert.throws(() => tool('create_task', { ...args, title: 'Changed' }), /different arguments/);
  run(f.db, "UPDATE agent_runs SET state = 'SUCCEEDED' WHERE state = 'RUNNING'");
  const newTool = toolRun(f);
  f.db.exec("CREATE TRIGGER reject_agent_journal BEFORE INSERT ON agent_tool_calls BEGIN SELECT RAISE(ABORT, 'journal unavailable'); END");
  assert.throws(() => newTool('create_task', { ...args, title: 'Rollback' }), /journal unavailable/);
  assert.equal(num(row(f.db, 'SELECT COUNT(*) AS c FROM tasks')?.c), 1); f.db.close();
});

test('queued research runs complete through actual domain tools without scheduling a loop', async () => {
  const f = onsite(); const task = createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'RESEARCH', title: 'Assess budget', requestedOutcome: 'Summarize the recorded account' }, f.now); let step = 0;
  await runAgentCycle(f.db, async () => ++step === 1 ? calls(['complete_research', { output: 'Recorded account balance: $100.' }]) : reply('Research saved.'));
  assert.equal(row(f.db, 'SELECT state FROM tasks WHERE id = ?', [task.id])?.state, 'COMPLETED');
  assert.equal(row(f.db, 'SELECT state FROM agent_runs WHERE task_id = ?', [task.id])?.state, 'SUCCEEDED');
  assert.equal(await runAgentCycle(f.db, async () => { throw new Error('Must not run again'); }), false); f.db.close();
});

test('a purchase run records a real reserved proposal and never marks it paid', async () => {
  const f = onsite(); const task = createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'PURCHASE', title: 'Known sandbox purchase', requestedOutcome: 'Submit $15 to Fixture merchant', mandateId: f.mandate.id }, f.now); let step = 0;
  await runAgentCycle(f.db, async () => ++step === 1 ? calls(['submit_proposal', { merchantId: 'merchant', amountCents: 1500, reason: 'Explicit task terms' }]) : reply('Proposal reserved; payment has not completed.'));
  assert.equal(row(f.db, 'SELECT state FROM proposals WHERE task_id = ?', [task.id])?.state, 'RESERVED');
  assert.equal(row(f.db, 'SELECT state FROM tasks WHERE id = ?', [task.id])?.state, 'WAITING_PAYMENT');
  assert.equal(num(row(f.db, 'SELECT COUNT(*) AS c FROM payment_operations')?.c), 0); f.db.close();
});

test('purchase tools refuse outstanding instructions until application is recorded', () => {
  const f = onsite(); const task = createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'PURCHASE', title: 'Purchase', requestedOutcome: 'Known $15 purchase', mandateId: f.mandate.id }, f.now);
  const instruction = queueInstruction(f.db, f.owner, task.id, 'Use the specified merchant and amount.', 'HUMAN_UI', f.now);
  const claim = claimTask(f.db, internalContext(f.db, f.registration.id), task.id, f.now);
  const binding = { taskId: task.id, revision: task.revision, leaseToken: claim.leaseToken }; const tool = toolRun(f, 'TASK', task.id);
  assert.equal((tool('submit_proposal', { merchantId: 'merchant', amountCents: 1500, reason: 'Known terms' }, 'proposal1', binding).error as { code: string }).code, 'INSTRUCTIONS_PENDING');
  tool('update_task', { phase: 'ready', note: 'Applied merchant and amount instruction.', appliedInstructionIds: [instruction.id] }, 'update', binding);
  assert.equal(tool('submit_proposal', { merchantId: 'merchant', amountCents: 1500, reason: 'Known terms' }, 'proposal2', binding).state, 'RESERVED'); f.db.close();
});

test('pause during provider I/O fences late mutations, and resume dispatches the task again', async () => {
  const f = onsite(); const task = createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'RESEARCH', title: 'Pause me', requestedOutcome: 'Will be paused' }, f.now);
  await runAgentCycle(f.db, async () => { pauseRegistration(f.db, f.owner, f.registration.id, Date.now()); return calls(['complete_research', { output: 'Must not be written' }]); });
  assert.equal(row(f.db, 'SELECT state FROM tasks WHERE id = ?', [task.id])?.state, 'PAUSED'); assert.equal(num(row(f.db, 'SELECT COUNT(*) AS c FROM task_updates')?.c), 0);
  resumeRegistration(f.db, f.owner, f.registration.id, Date.now()); let step = 0;
  await runAgentCycle(f.db, async () => ++step === 1 ? calls(['complete_research', { output: 'Resumed safely' }]) : reply('Done'));
  assert.equal(row(f.db, 'SELECT state FROM tasks WHERE id = ?', [task.id])?.state, 'COMPLETED'); f.db.close();
});

test('worker shutdown fences late model actions', async () => {
  const f = onsite(); const task = createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'RESEARCH', title: 'Stop me', requestedOutcome: 'Stops before tool mutation' }, f.now); const controller = new AbortController();
  await runAgentCycle(f.db, async () => { controller.abort(); return calls(['complete_research', { output: 'Must not apply' }]); }, controller.signal);
  assert.equal(row(f.db, 'SELECT state FROM tasks WHERE id = ?', [task.id])?.state, 'IN_PROGRESS'); assert.equal(num(row(f.db, 'SELECT COUNT(*) AS c FROM task_updates')?.c), 0);
  assert.equal(row(f.db, 'SELECT error_code FROM agent_runs WHERE task_id = ?', [task.id])?.error_code, 'AGENT_INTERRUPTED'); f.db.close();
});

test('removed members cannot execute a queued chat, even after it was authorized', async () => {
  const f = onsite('BUSINESS'); run(f.db, "INSERT INTO memberships (workspace_id, user_id, role, state, version, joined_at) VALUES (?, 'owner2', 'owner', 'ACTIVE', 1, 1)", [f.workspace.id]);
  const second = human(f.workspace.id, 'owner2'); const chat = sendChat(f.db, second, f.registration.id, { text: 'Hello' }, f.now);
  run(f.db, "UPDATE memberships SET state = 'REMOVED' WHERE user_id = 'owner2'");
  let requested = false; await runAgentCycle(f.db, async () => { requested = true; return reply(); });
  assert.equal(requested, false); assert.equal(row(f.db, 'SELECT state FROM agent_runs WHERE id = ?', [chat.id])?.state, 'FAILED'); f.db.close();
});

test('interrupted runs require explicit retry; successful task side effects survive recovery', async () => {
  const f = onsite(); const first = sendChat(f.db, f.owner, f.registration.id, { text: 'Create one research task' }, f.now);
  let step = 0;
  await runAgentCycle(f.db, async () => { if (++step === 1) return calls(['create_task', { kind: 'RESEARCH', title: 'Created once', requestedOutcome: 'Research budget' }]); throw new Error('Controlled interruption'); });
  assert.equal(row(f.db, 'SELECT state FROM agent_runs WHERE id = ?', [first.id])?.state, 'FAILED');
  retryAgentRun(f.db, f.owner, f.registration.id, first.id, Date.now()); step = 0;
  await runAgentCycle(f.db, async () => ++step === 1 ? calls(['create_task', { kind: 'RESEARCH', title: 'Created once', requestedOutcome: 'Research budget' }, 'new-call-id']) : reply('Created once.'));
  assert.equal(num(row(f.db, 'SELECT COUNT(*) AS c FROM tasks')?.c), 1);
  const waiting = sendChat(f.db, f.owner, f.registration.id, { text: 'Another message' }, Date.now());
  run(f.db, "UPDATE agent_runs SET state = 'RUNNING', claim_token = 'old', claimed_until = ? WHERE id = ?", [Date.now() - 1, waiting.id]);
  recoverAgentRuns(f.db, Date.now());
  assert.equal(row(f.db, 'SELECT error_code FROM agent_runs WHERE id = ?', [waiting.id])?.error_code, 'AGENT_INTERRUPTED');
  assert.throws(() => executeAgentTool(f.db, waiting.id, 'old', { type: 'function_call', call_id: 'late', name: 'create_task', arguments: '{}' }, null, Date.now()), /interrupted or replaced/); f.db.close();
});

test('worker steps and tool calls are bounded and do not loop on a failed trigger', async () => {
  const f = onsite(); process.env.AGENT_MAX_STEPS = '1'; process.env.AGENT_MAX_TOOL_CALLS = '1'; resetEnvCache();
  const task = createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'RESEARCH', title: 'Bounded', requestedOutcome: 'Do not loop' }, f.now);
  await runAgentCycle(f.db, async () => calls(['get_agent_state', {}, 'one'], ['get_agent_state', {}, 'two']));
  assert.equal(row(f.db, 'SELECT error_code FROM agent_runs WHERE task_id = ?', [task.id])?.error_code, 'AGENT_TOOL_LIMIT');
  assert.equal(num(row(f.db, 'SELECT COUNT(*) AS c FROM agent_tool_calls')?.c), 1);
  assert.equal(await runAgentCycle(f.db, async () => { throw new Error('No auto retry'); }), false); f.db.close();
});

test('new instructions schedule one new task run, without replaying applied instructions', async () => {
  const f = onsite(); const task = createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'RESEARCH', title: 'Wait for input', requestedOutcome: 'Needs more information' }, f.now);
  await runAgentCycle(f.db, async () => reply('Please supply more information.'));
  assert.equal(await runAgentCycle(f.db, async () => reply('Should not run')), false);
  const instruction = queueInstruction(f.db, f.owner, task.id, 'Use the recorded account.', 'HUMAN_UI', Date.now()); let step = 0;
  await runAgentCycle(f.db, async () => ++step === 1 ? calls(['update_task', { phase: 'needs-input', note: 'Applied instruction, waiting for a date.', appliedInstructionIds: [instruction.id] }]) : reply('Which date?'));
  assert.equal(num(row(f.db, 'SELECT COUNT(*) AS c FROM agent_runs')?.c), 2);
  assert.equal(await runAgentCycle(f.db, async () => reply('Must not loop')), false); f.db.close();
});

test('daily limits reject new chats and suppress automatic dispatch', async () => {
  const f = onsite(); process.env.AGENT_DAILY_RUN_LIMIT = '1'; resetEnvCache();
  sendChat(f.db, f.owner, f.registration.id, { text: 'One request' }, f.now);
  assert.throws(() => sendChat(f.db, f.owner, f.registration.id, { text: 'Second request' }, f.now), /daily agent run limit/);
  createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'RESEARCH', title: 'Wait', requestedOutcome: 'Limit reached' }, f.now);
  scheduleAgentTasks(f.db, f.now); assert.equal(num(row(f.db, 'SELECT COUNT(*) AS c FROM agent_runs')?.c), 1); f.db.close();
});

test('new instructions can revise a proposal waiting for review without inheriting approval', async () => {
  const f = onsite(); run(f.db, "UPDATE mandates SET execution_mode = 'PROPOSE_ONLY' WHERE id = ?", [f.mandate.id]);
  const task = createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'PURCHASE', title: 'Review purchase', requestedOutcome: 'Known $15 terms', mandateId: f.mandate.id }, f.now); let step = 0;
  await runAgentCycle(f.db, async () => ++step === 1 ? calls(['submit_proposal', { merchantId: 'merchant', amountCents: 1500, reason: 'Known terms' }]) : reply('Waiting for review.'));
  assert.equal(row(f.db, 'SELECT state FROM tasks WHERE id = ?', [task.id])?.state, 'WAITING_APPROVAL');
  const instruction = queueInstruction(f.db, f.owner, task.id, 'Reduce the amount to $10.', 'HUMAN_UI', Date.now()); step = 0;
  await runAgentCycle(f.db, async () => ++step === 1 ? calls(
    ['update_task', { phase: 'revising', note: 'Applied new $10 instruction', appliedInstructionIds: [instruction.id] }, 'apply'],
    ['revise_plan', { reason: 'User requested $10 instead of $15' }, 'revise'],
    ['submit_proposal', { merchantId: 'merchant', amountCents: 1000, reason: 'New human terms' }, 'propose'],
  ) : reply('New terms are waiting for review.'));
  const proposals = rows(f.db, 'SELECT state, amount_cents FROM proposals WHERE task_id = ? ORDER BY task_revision', [task.id]);
  assert.equal(proposals[0].state, 'CANCELLED'); assert.equal(proposals[1].state, 'REVIEW_REQUIRED'); assert.equal(proposals[1].amount_cents, 1000);
  assert.equal(num(row(f.db, 'SELECT COUNT(*) AS c FROM payment_operations')?.c), 0); f.db.close();
});

test('a stale purchase account is read and validated before Grok can propose, without a banking POST', async () => {
  const f = onsite(); let reads = 0; let writes = 0;
  run(f.db, 'UPDATE wallets SET last_verified_at = ?', [Date.now() - 120_000]);
  const adapter = banking(async () => { writes++; throw new Error('No POST from the agent'); });
  const actualRead = adapter.getAccount; adapter.getAccount = async id => { reads++; return actualRead(id); }; setBankingAdapterForTests(adapter);
  const task = createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'PURCHASE', title: 'Fresh facts', requestedOutcome: 'Known $15 terms', mandateId: f.mandate.id }, f.now); let step = 0;
  await runAgentCycle(f.db, async () => ++step === 1 ? calls(['submit_proposal', { merchantId: 'merchant', amountCents: 1500, reason: 'Fresh authorized facts' }]) : reply('Reserved.'));
  assert.equal(reads, 1); assert.equal(writes, 0); assert.equal(row(f.db, 'SELECT state FROM proposals WHERE task_id = ?', [task.id])?.state, 'RESERVED'); f.db.close();
});

test('task runs never receive a controller’s private chat as source material', async () => {
  const f = onsite(); sendChat(f.db, f.owner, f.registration.id, { text: 'Private conversation' }, f.now);
  run(f.db, "UPDATE agent_runs SET state = 'CANCELLED'");
  createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'RESEARCH', title: 'Shared work', requestedOutcome: 'Use authorized account facts only' }, f.now); let step = 0;
  await runAgentCycle(f.db, async request => {
    if (++step === 1) { assert(!JSON.stringify(request.input).includes('Private conversation')); return calls(['get_agent_state', {}, 'read']); }
    const result = request.input.findLast(i => i.type === 'function_call_output');
    assert.deepEqual(JSON.parse(String(result?.output)).recentChat, []); return reply('Shared facts only.');
  }); f.db.close();
});

test('on-site voice works without an external tool verification or permanent browser key', async () => {
  const f = onsite(); let calls = 0;
  globalThis.fetch = async (url, init) => { calls++; assert.equal(String(url), 'https://api.x.ai/v1/realtime/client_secrets'); assert(String((init?.headers as Record<string, string>).authorization).includes(getEnv().XAI_API_KEY!)); return Response.json({ client_secret: { value: 'ephemeral-test-credential' } }); };
  const session = await createVoiceSession(f.db, f.owner, { registrationId: f.registration.id }, Date.now());
  assert.equal(calls, 1); assert.equal(session.ephemeralCredential, 'ephemeral-test-credential'); assert(!JSON.stringify(session).includes(getEnv().XAI_API_KEY!));
  assert(session.instructions.includes('Explain account facts clearly.')); assert.equal(getRegistration(f.db, f.owner, f.registration.id).toolsVerifiedAt, null); f.db.close();
});

test('xAI requests use manual context, no stored response and server-only credentials', async () => {
  let payload: Record<string, unknown> = {};
  globalThis.fetch = async (url, init) => { assert.equal(String(url), 'https://api.x.ai/v1/responses'); payload = JSON.parse(String(init?.body)); assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${getEnv().XAI_API_KEY}`); return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] }] }); };
  assert.equal((await grokResponse({ model: getEnv().XAI_AGENT_MODEL, input: [{ role: 'user', content: 'Hello' }], tools: [], signal: new AbortController().signal })).text, 'Hello');
  assert.equal(payload.store, false); assert.equal(payload.parallel_tool_calls, false); assert.equal(payload.signal, undefined); assert.equal(payload.previous_response_id, undefined); assert.equal(payload.max_output_tokens, 2048);
});

test('provider errors, incomplete responses and malformed calls are safe failures', async () => {
  globalThis.fetch = async () => Response.json({ error: { secret: getEnv().XAI_API_KEY } }, { status: 401 });
  await assert.rejects(grokResponse({ model: 'invalid', input: [], tools: [] }), error => error instanceof Error && error.message.includes('operator') && !error.message.includes(getEnv().XAI_API_KEY!));
  assert.throws(() => parseModelResponse({ status: 'incomplete', output: [] }), /did not complete/);
  assert.throws(() => parseModelResponse({ status: 'completed', output: [{ type: 'function_call', name: 'get_agent_state', arguments: '{}' }] }), /malformed tool/);
  assert.throws(() => parseModelResponse({ status: 'completed', output: [{ type: 'message', role: 'user', content: [] }] }), /malformed message/);
});

test('v2 connection migration preserves leases, financial records and foreign-key enforcement', () => {
  const f = fixture(); const purchase = f.purchase();
  const currentSchema = readFileSync(new URL('../src/storage/schema.sql', import.meta.url), 'utf8');
  const oldConnectionSchema = currentSchema.match(/CREATE TABLE IF NOT EXISTS connections \([\s\S]*?\n\);/)![0].replace('IF NOT EXISTS connections', 'connections_v2').replace(", 'INTERNAL'", '');
  f.db.exec('PRAGMA foreign_keys = OFF');
  f.db.exec(`${oldConnectionSchema}\nINSERT INTO connections_v2 SELECT * FROM connections; DROP TABLE connections; ALTER TABLE connections_v2 RENAME TO connections;`);
  f.db.exec('DROP TABLE agent_tool_calls; DROP TABLE agent_runs; DROP TABLE agent_messages; DROP TABLE agent_conversations; DROP TABLE agent_profiles; DROP TABLE agent_worker_status;');
  run(f.db, "DELETE FROM schema_migrations WHERE id = '003_onsite_agents'"); run(f.db, "UPDATE app_meta SET value = '2' WHERE key = 'schema_version'");
  f.db.exec('PRAGMA foreign_keys = ON');
  migrateApplication(f.db); migrateApplication(f.db);
  assert.equal(num(row(f.db, 'PRAGMA foreign_keys')?.foreign_keys), 1); assert.equal(rows(f.db, 'PRAGMA foreign_key_check').length, 0);
  assert.equal(row(f.db, 'SELECT connection_id FROM task_leases WHERE task_id = ?', [purchase.task.id])?.connection_id, f.connection.id);
  assert.equal(row(f.db, 'SELECT state FROM proposals WHERE id = ?', [purchase.proposal.id])?.state, 'RESERVED');
  assert.equal(createAgent(f.db, f.owner, { name: 'After migration', purpose: 'Works after upgrade', walletIds: [] }, Date.now()).executionMode, 'ONSITE'); f.db.close();
});

test('catalog product tool enforces price, user budget, pending instructions and policy without duplicate proposals', () => {
  const f = onsite();
  try {
    run(f.db, "UPDATE merchant_catalog SET label = 'Staples' WHERE id = 'merchant'");
    const task = createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'PURCHASE', title: 'Eraser', requestedOutcome: 'Buy an eraser under $10', mandateId: f.mandate.id }, f.now);
    const ctx = internalContext(f.db, f.registration.id);
    const claim = claimTask(f.db, ctx, task.id, f.now);
    const binding = { taskId: task.id, revision: 1, leaseToken: claim.leaseToken };
    const call = toolRun(f, 'TASK', task.id);
    const args = { productId: 'staples-1', quantity: 1, maxTotalCents: 999 };
    assert.ok(call('submit_product_proposal', { ...args, amountCents: 1 }, 'tampered', binding).error);
    assert.ok(call('submit_product_proposal', { ...args, maxTotalCents: 100 }, 'budget', binding).error);
    const instruction = queueInstruction(f.db, f.owner, task.id, 'Use the catalog price.', 'HUMAN_UI', f.now);
    assert.ok(call('submit_product_proposal', args, 'unapplied', binding).error);
    call('update_task', { phase: 'Planning', note: 'Applied catalog price instruction.', appliedInstructionIds: [instruction.id] }, 'apply', binding);
    const proposal = call('submit_product_proposal', args, 'purchase', binding);
    assert.equal(proposal.amountCents, 349); assert.equal(proposal.state, 'RESERVED');
    assert.match(String(proposal.reason), /staples-1/);
    assert.equal(call('submit_product_proposal', args, 'purchase', binding).id, proposal.id);
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM proposals')?.n), 1);
  } finally { f.db.close(); }
});

test('a bank observation that becomes stale during a model turn is refreshed before proposal execution', async () => {
  const f = onsite();
  try {
    let reads = 0;
    const adapter = banking(async () => { throw new Error('No payment in agent runner'); });
    const read = adapter.getAccount;
    adapter.getAccount = async id => { reads++; return read(id); };
    setBankingAdapterForTests(adapter);
    createTask(f.db, f.owner, { registrationId: f.registration.id, kind: 'PURCHASE', title: 'Known purchase', requestedOutcome: 'Pay $3.49 to the fixture merchant', mandateId: f.mandate.id }, f.now);
    let turn = 0;
    await runAgentCycle(f.db, async () => {
      if (++turn === 1) {
        run(f.db, 'UPDATE wallets SET last_verified_at = ?', [Date.now() - 120000]);
        return calls(['submit_proposal', { merchantId: 'merchant', amountCents: 349, reason: 'Requested purchase' }]);
      }
      return reply('Proposal recorded.');
    });
    assert.equal(reads, 1);
    assert.equal(row(f.db, 'SELECT state FROM proposals')?.state, 'RESERVED');
  } finally { f.db.close(); }
});
