import { z } from "zod";
import { CATEGORIES, type VoiceFunctionName } from "./constants";

const identifier = z.string().min(1).max(128);
const amount = z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Use a nonnegative dollar amount with up to two decimals.");
export const authorityTermsSchema = z.object({
  walletId: identifier,
  totalAllowance: amount,
  perPurchaseLimit: amount,
  reviewAbove: amount,
  allowedCategories: z.array(z.enum(CATEGORIES)).min(1).max(10),
  allowedMerchantIds: z.array(identifier).max(100).nullable(),
  executionMode: z.enum(["PROPOSE_ONLY", "AUTO_WITHIN_LIMITS"]),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  replaceMandateId: identifier.optional(),
}).strict();

export const voiceSchemas = {
  get_agent_state: z.object({}).strict(),
  get_context: z.object({}).strict(),
  get_task: z.object({ taskId: identifier }).strict(),
  queue_instruction: z.object({ taskId: identifier, text: z.string().trim().min(1).max(2000) }).strict(),
  create_task: z.object({
    kind: z.enum(["RESEARCH", "PURCHASE"]),
    title: z.string().trim().min(1).max(120),
    requestedOutcome: z.string().trim().min(1).max(2000),
    mandateId: identifier.nullable().optional(),
  }).strict(),
  pause_registration: z.object({}).strict(),
  draft_authority_change: authorityTermsSchema,
} satisfies Record<VoiceFunctionName, z.ZodType>;

const descriptions: Record<VoiceFunctionName, string> = {
  get_agent_state: "Read current tasks, proposals, balances, protections, and connection state for the selected Bot.",
  get_context: "Read the selected Bot's persisted facts before discussing banking decisions.",
  get_task: "Read a task and its queued directions, progress, and payment state for the selected Bot.",
  queue_instruction: "Queue a direction for a task of the selected Bot. Queued is not yet acknowledged or applied.",
  create_task: "Create an explicitly requested task for the selected Bot; purchases require an existing active mandate.",
  pause_registration: "Pause the selected Bot and cancel unsubmitted proposals; submitted bank operations continue reconciliation.",
  draft_authority_change: "Draft exact new allowance terms for owner review; this never grants authority. Supply expiry as epoch milliseconds.",
};

export function voiceToolDefinitions(names: readonly string[]) {
  return names.filter((name): name is VoiceFunctionName => name in voiceSchemas).map((name) => {
    const { $schema: _schema, ...parameters } = z.toJSONSchema(voiceSchemas[name]);
    void _schema;
    return { type: "function" as const, name, description: descriptions[name], parameters };
  });
}
