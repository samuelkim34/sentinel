import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { FORBIDDEN_CONNECTOR_TOOLS } from "../contracts/constants";
import { loadMembership, type ConnectorContext } from "../domain/access";
import { effectiveCategory } from "../domain/accounts";
import { markToolsVerified, getTask } from "../domain/proposals";
import { agentState } from "../domain/agent-state";
import {
  acknowledgeInstruction,
  claimTask,
  completeResearch,
  revisePlan,
  submitPurchase,
  updateTask,
} from "../domain/proposals";
import { getDb } from "../storage/db";
import { row, rows, text } from "../storage/sql";

export const MCP_TOOL_NAMES = [
  "get_context",
  "list_merchants",
  "get_next_task",
  "get_task",
  "get_agent_state",
  "update_task",
  "acknowledge_instruction",
  "revise_plan",
  "submit_proposal",
  "complete_research",
] as const;

export function forbiddenToolsAbsent(): boolean {
  return FORBIDDEN_CONNECTOR_TOOLS.every((name) => !MCP_TOOL_NAMES.includes(name as never));
}

export function buildMcpServer(ctx: ConnectorContext): McpServer {
  const server = new McpServer({ name: "sentinel", version: "1.0.0" });
  const db = getDb();
  server.registerTool("get_context", { description: "Bound registration, wallets, mandates, and server time. No approval authority.", inputSchema: z.object({}).strict() }, async () => {
    requireScope(ctx, "context:read");
    markToolsVerified(db, ctx.connectionId, Date.now());
    return json(contextPayload(ctx));
  });

  server.registerTool("list_merchants", {
    description: "Permitted merchant catalog. Categories come from server mappings.",
    inputSchema: z.object({ category: z.string().optional(), search: z.string().max(80).optional() }).strict(),
  }, async ({ search, category }) => {
    requireScope(ctx, "context:read");
    const merchants = rows(db, "SELECT * FROM merchant_catalog ORDER BY label ASC");
    return json(merchants.map((item) => ({
      id: text(item.id),
      label: text(item.label),
      verifiedCategory: effectiveCategory(db, ctx.workspaceId, text(item.id), text(item.verified_category)),
    })).filter((item) => (!search || item.label.toLowerCase().includes(search.toLowerCase())) && (!category || item.verifiedCategory === category)).slice(0, 100));
  });

  server.registerTool("get_next_task", {
    description: "Atomically claim one eligible task for this registration.",
    inputSchema: z.object({ taskId: z.string().optional() }).strict(),
  }, async ({ taskId }) => json(claimTask(db, ctx, taskId, Date.now())));

  server.registerTool("get_task", {
    description: "Read one task bound to this registration.",
    inputSchema: z.object({ taskId: z.string() }).strict(),
  }, async ({ taskId }) => {
    requireScope(ctx, "tasks:read");
    const task = getTask(db, connectorHuman(ctx), taskId);
    if (task.workspaceId !== ctx.workspaceId || task.registrationId !== ctx.registrationId || task.controllerUserId !== ctx.userId) {
      throw new Error("That task is outside this connection.");
    }
    return json(task);
  });

  server.registerTool("get_agent_state", { description: "Factual work, blockers, and last tool access for this registration.", inputSchema: z.object({}).strict() }, async () => {
    requireScope(ctx, "context:read");
    return json(contextPayload(ctx));
  });

  server.registerTool("update_task", {
    description: "Record progress. Cannot mark an unsettled purchase complete.",
    inputSchema: z.object({
      taskId: z.string(),
      revision: z.number().int(),
      leaseToken: z.string(),
      phase: z.string().max(80),
      note: z.string().max(2000),
      evidence: z.unknown().optional(),
      appliedInstructionIds: z.array(z.string()).optional(),
    }).strict(),
  }, async (input) => json(updateTask(db, ctx, { ...input, evidence: input.evidence ?? [] }, Date.now())));

  server.registerTool("acknowledge_instruction", {
    description: "Acknowledge a queued instruction. Acknowledgement is not application.",
    inputSchema: z.object({ instructionId: z.string(), taskId: z.string(), revision: z.number().int(), leaseToken: z.string() }).strict(),
  }, async (input) => json(acknowledgeInstruction(db, ctx, input, Date.now())));

  server.registerTool("revise_plan", {
    description: "Start a new task revision when no irreversible submission exists.",
    inputSchema: z.object({ taskId: z.string(), expectedRevision: z.number().int(), leaseToken: z.string(), reason: z.string().max(500) }).strict(),
  }, async (input) => json(revisePlan(db, ctx, input, Date.now())));

  server.registerTool("submit_proposal", {
    description: "Submit immutable purchase terms. The result is a policy decision, not a payment.",
    inputSchema: z.object({
      taskId: z.string(),
      revision: z.number().int(),
      leaseToken: z.string(),
      merchantId: z.string(),
      amountCents: z.number().int().positive(),
      reason: z.string().max(1000),
    }).strict(),
  }, async (input) => json(submitPurchase(db, ctx, input, Date.now())));

  server.registerTool("complete_research", {
    description: "Complete a research task with output and evidence.",
    inputSchema: z.object({
      taskId: z.string(),
      revision: z.number().int(),
      leaseToken: z.string(),
      output: z.string().max(4000),
      evidence: z.unknown().optional(),
    }).strict(),
  }, async (input) => json(completeResearch(db, ctx, { ...input, evidence: input.evidence ?? [] }, Date.now())));

  return server;
}

function contextPayload(ctx: ConnectorContext) {
  return { ...agentState(getDb(), connectorHuman(ctx), ctx.registrationId), scopes: [...ctx.scopes] };
}

function connectorHuman(ctx: ConnectorContext) {
  const member = loadMembership(getDb(), ctx.workspaceId, ctx.userId);
  if (!member || member.state !== "ACTIVE") throw new Error("Membership is no longer active.");
  return { kind: "human" as const, userId: ctx.userId, workspaceId: ctx.workspaceId, role: member.role, sessionId: "connector-read-only" };
}

function requireScope(ctx: ConnectorContext, scope: string) {
  const connection = row(getDb(), "SELECT state FROM connections WHERE id = ?", [ctx.connectionId]);
  if (!connection || text(connection.state) !== "ACTIVE") throw new Error("Connection is no longer active.");
  if (!ctx.scopes.has(scope)) throw new Error(`Missing connector scope ${scope}.`);
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
