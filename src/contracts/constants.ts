export const SCHEMA_VERSION = 2;

export const CATEGORIES = [
  "GROCERIES",
  "DINING",
  "TRANSPORT",
  "UTILITIES",
  "OFFICE",
  "SOFTWARE",
  "TRAVEL",
  "HEALTH",
  "ENTERTAINMENT",
  "OTHER",
  "UNKNOWN",
] as const;

export type MerchantCategory = (typeof CATEGORIES)[number];

export const CONNECTOR_SCOPES = [
  "context:read",
  "tasks:read",
  "tasks:update",
  "proposals:write",
] as const;

export type ConnectorScope = (typeof CONNECTOR_SCOPES)[number];

export const OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  ...CONNECTOR_SCOPES,
] as const;

export const VOICE_FUNCTIONS = [
  "get_agent_state",
  "get_context",
  "get_task",
  "queue_instruction",
  "create_task",
  "pause_registration",
  "draft_authority_change",
] as const;

export type VoiceFunctionName = (typeof VOICE_FUNCTIONS)[number];

export const FORBIDDEN_CONNECTOR_TOOLS = [
  "approve_purchase",
  "execute_payment",
  "grant_mandate",
  "raise_budget",
  "change_protection",
  "impersonate_user",
  "arbitrary_fetch",
  "run_sql",
  "raw_bank_request",
  "create_financial_task",
] as const;

export const PROPOSAL_STATES = [
  "BLOCKED",
  "REVIEW_REQUIRED",
  "RESERVED",
  "SUBMITTING",
  "SUBMITTED_PENDING",
  "RECONCILE_REQUIRED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type ProposalState = (typeof PROPOSAL_STATES)[number];

export const UNRESOLVED_PAYMENT_STATES = ["SUBMITTING", "SUBMITTED_PENDING", "RECONCILE_REQUIRED"] as const;

export const TASK_STATES = [
  "QUEUED",
  "IN_PROGRESS",
  "WAITING_APPROVAL",
  "WAITING_PAYMENT",
  "BLOCKED",
  "NEEDS_RECONCILIATION",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type TaskState = (typeof TASK_STATES)[number];
