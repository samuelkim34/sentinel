import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { AppError, conflict, forbidden, invalid } from '../contracts/errors';
import { atomic, num, row, run, text, type SqlRow } from '../storage/sql';
import { agentState } from '../domain/agent-state';
import { internalContext, runHuman } from '../domain/agents';
import { listMerchants } from '../domain/accounts';
import { requireActiveMember, type HumanContext } from '../domain/access';
import { canonicalHash } from '../domain/ids';
import { acknowledgeInstruction, completeResearch, createTask, getTask, queueInstruction, revisePlan, submitPurchase, updateTask } from '../domain/proposals';
import type { FunctionCall, ModelItem } from './grok-client';

import { listProducts, quoteProduct } from '../domain/products';

const shortId = z.string().min(1).max(100);
const schemas = {
  get_agent_state: z.object({}).strict(),
  list_merchants: z.object({ search: z.string().max(100).nullable() }).strict(),
  search_products: z.object({ search: z.string().max(100) }).strict(),
  submit_product_proposal: z.object({ productId: shortId, quantity: z.number().int().min(1).max(100), maxTotalCents: z.number().int().positive().max(1_000_000_000) }).strict(),
  get_task: z.object({ taskId: shortId }).strict(),
  queue_instruction: z.object({ taskId: shortId, text: z.string().min(1).max(2000) }).strict(),
  create_task: z.object({ kind: z.enum(['RESEARCH','PURCHASE']), title: z.string().min(1).max(120), requestedOutcome: z.string().min(1).max(2000) }).strict(),
  update_task: z.object({ phase: z.string().min(1).max(80), note: z.string().min(1).max(2000), appliedInstructionIds: z.array(shortId).max(20) }).strict(),
  acknowledge_instruction: z.object({ instructionId: shortId }).strict(),
  revise_plan: z.object({ reason: z.string().min(1).max(300) }).strict(),
  submit_proposal: z.object({ merchantId: shortId, amountCents: z.number().int().positive().max(1_000_000_000), reason: z.string().min(1).max(1000) }).strict(),
  complete_research: z.object({ output: z.string().min(1).max(4000) }).strict(),
};
type ToolName = keyof typeof schemas;
const descriptions: Record<ToolName, string> = {
  get_agent_state: 'Read this agent’s current authorized accounts, allowances, tasks and recorded facts. Fetch before answering financial questions.',
  list_merchants: 'Find merchants from the synced Nessie sandbox catalog. This provides no retail products, prices or checkout.',
  search_products: 'Search fixed fictional sandbox products by simple keywords such as eraser or Staples. Prices include all simulated taxes/fees. No real orders, bookings or subscriptions. An empty search lists all products. No need to ask the user for a listed product price.',
  submit_product_proposal: 'Propose a catalog product for the bound task. The server determines merchant and price. Set maxTotalCents from the user budget, or the catalog total when no separate budget was given. Existing allowance and approval checks still apply. Never submit another proposal after one is recorded.',
  get_task: 'Read a task assigned to this agent. Task runs can read only their bound task.',
  queue_instruction: 'Record a new instruction from the chatting user for this agent’s task. Use only when the user requests it.',
  create_task: 'Create one task requested by this chat message. PURCHASE is allowed only with the allowance explicitly selected by the user; otherwise choose RESEARCH. Never invent purchase terms.',
  update_task: 'Record visible progress for the bound task, and instructions actually applied. Does not complete a payment.',
  acknowledge_instruction: 'Acknowledge a queued instruction on the bound task. Acknowledged does not mean applied.',
  revise_plan: 'Revise the bound task’s plan before an irreversible payment. Use only to apply a genuine new human instruction; never to repeat a purchase.',
  submit_proposal: 'Submit known purchase terms for the bound task to Sentinel’s policy engine. Amount is integer USD cents. Returns actual review, blocked or reserved status, never proof of payment.',
  complete_research: 'Save the bound research task’s factual output and mark research complete. Never available to complete a purchase.',
};

export function agentTools(kind: string): ModelItem[] {
  const names: ToolName[] = kind === 'CHAT' ? ['get_agent_state','list_merchants','search_products','get_task','queue_instruction','create_task'] : ['get_agent_state','list_merchants','search_products','get_task','update_task','acknowledge_instruction','revise_plan','submit_product_proposal','submit_proposal','complete_research'];
  return names.map(name => ({ type: 'function', name, description: descriptions[name], parameters: z.toJSONSchema(schemas[name]), strict: true }));
}

export type TaskBinding = { taskId: string; revision: number; leaseToken: string };

export function assertRunClaim(db: DatabaseSync, runId: string, claimToken: string, now: number) {
  const found = row(db, "SELECT * FROM agent_runs WHERE id = ? AND state = 'RUNNING' AND claim_token = ? AND claimed_until > ?", [runId, claimToken, now]);
  if (!found) throw conflict('AGENT_CLAIM_LOST', 'This run was interrupted or replaced.');
  internalContext(db, text(found.registration_id));
  runHuman(db, found);
  return found;
}

export function executeAgentTool(db: DatabaseSync, runId: string, claimToken: string, call: FunctionCall, binding: TaskBinding | null, now: number) {
  return atomic(db, () => {
    const activeRun = assertRunClaim(db, runId, claimToken, now);
    const requestHash = canonicalHash({ name: call.name, arguments: call.arguments });
    const previous = row(db, 'SELECT * FROM agent_tool_calls WHERE run_id = ? AND call_id = ?', [runId, call.call_id]);
    if (previous) {
      if (text(previous.request_hash) !== requestHash) throw conflict('AGENT_CALL_CONFLICT', 'Grok reused a tool-call ID with different arguments.');
      return JSON.parse(text(previous.result_json)) as unknown;
    }
    let result: unknown; let isError = 0;
    try {
      // A savepoint rolls back partial mutations when a tool returns an error.
      result = atomic(db, () => dispatch(db, activeRun, call, binding, now));
    } catch (error) {
      if (error instanceof AppError) result = { error: { code: error.code, message: error.message } };
      else if (error instanceof z.ZodError || error instanceof SyntaxError) result = { error: { code: 'INVALID_TOOL_ARGUMENTS', message: 'Use the exact tool schema and authorized task.' } };
      else throw error;
      isError = 1;
    }
    const serialized = JSON.stringify(result ?? null);
    const bounded = Buffer.byteLength(serialized) > 60_000 ? JSON.stringify({ truncated: true, message: 'The result is too large. Query one task or narrower merchant search instead.' }) : serialized;
    run(db, 'INSERT INTO agent_tool_calls (run_id, call_id, name, request_hash, result_json, is_error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [runId, call.call_id, call.name, requestHash, bounded, isError, now]);
    const ctx = internalContext(db, text(activeRun.registration_id));
    run(db, 'UPDATE connections SET last_seen_at = ? WHERE id = ?', [now, ctx.connectionId]);
    return JSON.parse(bounded) as unknown;
  });
}

function dispatch(db: DatabaseSync, activeRun: SqlRow, call: FunctionCall, binding: TaskBinding | null, now: number): unknown {
  const allowed = agentTools(text(activeRun.kind)).some(t => t.name === call.name);
  if (!allowed || !(call.name in schemas)) throw forbidden('This tool is not available to this run.', 'AGENT_TOOL_FORBIDDEN');
  const name = call.name as ToolName;
  const args = JSON.parse(call.arguments);
  schemas[name].parse(args);
  const ctx = internalContext(db, text(activeRun.registration_id));
  const requester = runHuman(db, activeRun);
  const member = requireActiveMember(db, ctx.workspaceId, ctx.userId);
  const controller: HumanContext = { kind: 'human', userId: ctx.userId, workspaceId: ctx.workspaceId, role: member.role, sessionId: '' };
  const human = text(activeRun.kind) === 'CHAT' ? requester : controller;
  if (name === 'get_agent_state') {
    const state = agentState(db, human, ctx.registrationId, now);
    // Chat already receives message-bounded history in its model input. Task
    // output must not be generated from a controller’s private conversation.
    // The voice gateway separately supplies only its current user’s history.
    return { ...state, recentChat: [] };
  }
  if (name === 'search_products') return { products: listProducts(db, human, args.search) };
  if (name === 'list_merchants') return { merchants: listMerchants(db, human, args.search ?? undefined).slice(0, 50) };
  if (name === 'get_task' || name === 'queue_instruction') {
    const task = getTask(db, human, args.taskId);
    if (task.registrationId !== ctx.registrationId || (binding && task.id !== binding.taskId)) throw forbidden('This task is outside the run’s agent.', 'TASK_BINDING');
    if (name === 'get_task') return task;
    return queueInstruction(db, human, args.taskId, args.text, 'HUMAN_UI', now, `agent-message:${num(activeRun.message_id)}:instruction:${canonicalHash(args)}`);
  }
  if (name === 'create_task') {
    if (args.kind === 'PURCHASE' && !activeRun.selected_mandate_id) throw forbidden('The user must select an allowance in the chat before creating a purchase task.', 'CHAT_PURCHASE_CONSENT');
    return createTask(db, human, { ...args, registrationId: ctx.registrationId, mandateId: args.kind === 'PURCHASE' ? text(activeRun.selected_mandate_id) : null, requestKey: `agent-message:${num(activeRun.message_id)}:task` }, now);
  }
  if (!binding || binding.taskId !== text(activeRun.task_id)) throw invalid('TASK_BINDING', 'This run has no bound task lease.');
  if (name === 'update_task') return updateTask(db, ctx, { ...args, ...binding, evidence: [] }, now);
  if (name === 'acknowledge_instruction') return acknowledgeInstruction(db, ctx, { ...args, ...binding }, now);
  if (name === 'revise_plan') {
    const changed = revisePlan(db, ctx, { taskId: binding.taskId, leaseToken: binding.leaseToken, expectedRevision: binding.revision, reason: args.reason }, now);
    binding.revision = changed.revision;
    return changed;
  }
  if (name === 'submit_proposal' || name === 'submit_product_proposal') {
    if (row(db, "SELECT id FROM instructions WHERE task_id = ? AND state != 'APPLIED'", [binding.taskId])) throw conflict('INSTRUCTIONS_PENDING', 'Apply and record outstanding human instructions before proposing a purchase.');
    const terms = name === 'submit_product_proposal' ? quoteProduct(db, human, args.productId, args.quantity, args.maxTotalCents) : args;
    return submitPurchase(db, ctx, { ...terms, ...binding }, now);
  }
  return completeResearch(db, ctx, { ...args, ...binding, evidence: [] }, now);
}
