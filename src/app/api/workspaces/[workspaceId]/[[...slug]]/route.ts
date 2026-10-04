import { recheckBlockedProposal } from "../../../../../domain/proposals";
import { listProducts } from '../../../../../domain/products';
import { CATEGORIES, type MerchantCategory } from "../../../../../contracts/constants";
import { notFound, unavailable } from "../../../../../contracts/errors";
import { parseUsdToCents } from "../../../../../contracts/money";
import {
  confirmMerchantCategory,
  confirmSuggestedMerchantCategories,
  createProtection,
  establishBaseline,
  getWallet,
  linkPermittedAccount,
  listLinkCandidates,
  listMerchants,
  listWallets,
  provisionSandboxAccount,
  refreshWallet,
  syncMerchants,
  updateProtection,
} from "../../../../../domain/accounts";
import {
  archiveRegistration,
  createConnection,
  createMandate,
  createRegistration,
  getRegistration,
  listMandates,
  listRegistrations,
  pauseRegistration,
  replaceMandate,
  resumeRegistration,
  revokeConnection,
  revokeMandate,
  updateRegistration,
  type MandateInput,
} from "../../../../../domain/authority";
import {
  approveProposal,
  cancelProposal,
  cancelTask,
  createTask,
  getProposal,
  getTask,
  listProposals,
  listTasks,
  queueInstruction,
  rejectProposal,
} from "../../../../../domain/proposals";
import { activityGraph, listEvents, overview } from "../../../../../domain/read-models";
import { queueReconcile } from "../../../../../domain/settlement";
import { getAuthorityDraft, confirmAuthorityDraft } from "../../../../../domain/voice";
import { createInvitation, listMembers, updateMember } from "../../../../../domain/workspaces";
import { resourceAdminHeaders } from "../../../../../server/auth/config";
import { auth } from "../../../../../server/auth/config";
import { getEnv } from "../../../../../server/env";
import { assertOrigin, errorResponse, idempotencyKey, json, readJson, resolveHuman } from "../../../../../server/http";
import { getDb } from "../../../../../storage/db";
import { atomic, run, row, text } from "../../../../../storage/sql";
import { requireHuman } from "../../../../../domain/access";
import { createAgent, updateAgent, enableOnsiteAgent, chatHistory, sendChat, retryAgentRun, agentRuntime } from '../../../../../domain/agents';

export const runtime = "nodejs";

async function handle(request: Request, workspaceId: string, slug: string[]) {
  assertOrigin(request);
  const human = await resolveHuman(request, workspaceId);
  const db = getDb();
  const now = Date.now();
  const body = request.method === "GET" ? {} : await readJson(request);
  const [a, b, c] = slug;

  if (request.method === 'GET' && a === 'agents' && b === 'runtime') return json(agentRuntime(db));
  if (request.method === 'POST' && a === 'agents' && !b) return json(createAgent(db, human, {
    name: body.name as string, purpose: body.purpose as string, instructions: body.instructions as string | undefined,
    walletIds: body.walletIds as string[] | undefined,
  }, now, idempotencyKey(request)), 201);
  if (request.method === 'PATCH' && a === 'agents' && b && !c) return json(updateAgent(db, human, b, {
    name: body.name as string, purpose: body.purpose as string, instructions: body.instructions as string | undefined,
    walletIds: body.walletIds as string[] | undefined, expectedVersion: Number(body.expectedVersion),
  }, now));
  if (request.method === 'POST' && a === 'agents' && b && c === 'enable') return json(enableOnsiteAgent(db, human, b, String(body.instructions ?? ''), now));
  if (request.method === 'GET' && a === 'agents' && b && c === 'chat') return json(chatHistory(db, human, b));
  if (request.method === 'POST' && a === 'agents' && b && c === 'chat') return json(sendChat(db, human, b, { text: body.text as string, mandateId: body.mandateId as string | null | undefined }, now, idempotencyKey(request)), 202);
  if (request.method === 'POST' && a === 'agents' && b && c === 'retry') return json(retryAgentRun(db, human, b, String(body.runId ?? ''), now), 202);

  if (request.method === "GET" && a === "overview") return json(overview(db, human));
  if (request.method === "GET" && a === "members") return json({ members: listMembers(db, human) });
  if (request.method === "POST" && a === "invitations") {
    return json(createInvitation(db, human, String(body.role ?? "member") as "owner" | "finance" | "member", now, getEnv().APP_ORIGIN), 201);
  }
  if (request.method === "PATCH" && a === "members" && b) {
    return json(updateMember(db, human, b, {
      role: body.role as "owner" | "finance" | "member" | undefined,
      state: body.state as "ACTIVE" | "REMOVED" | undefined,
      expectedVersion: Number(body.expectedVersion),
    }, now));
  }
  if (request.method === "GET" && a === "banking" && b === "customers") return json(await listLinkCandidates(db, human));
  if (request.method === "POST" && a === "banking" && b === "link") {
    return json(await linkPermittedAccount(db, human, { customerId: String(body.customerId ?? ""), accountId: String(body.accountId ?? "") }, now), 201);
  }
  if (request.method === "POST" && a === "banking" && b === "provision") {
    return json(await provisionSandboxAccount(db, human, {
      firstName: String(body.firstName ?? ""),
      lastName: String(body.lastName ?? ""),
      streetNumber: String(body.streetNumber ?? ""),
      streetName: String(body.streetName ?? ""),
      city: String(body.city ?? ""),
      state: String(body.state ?? ""),
      zip: String(body.zip ?? ""),
      accountType: body.accountType === "Savings" ? "Savings" : "Checking",
      nickname: String(body.nickname ?? "Sandbox account"),
      balanceCents: parseUsdToCents(body.balance ?? 0),
    }, now), 201);
  }
  if (request.method === "GET" && a === "accounts" && !b) return json({ accounts: listWallets(db, human) });
  if (request.method === "GET" && a === "accounts" && b) return json(getWallet(db, human, b));
  if (request.method === "POST" && a === "accounts" && b && c === "refresh") return json(await refreshWallet(db, human, b, now));
  if (request.method === "POST" && a === "accounts" && b && c === "baseline") return json(establishBaseline(db, human, b, now));
  if (request.method === "POST" && a === "protections") {
    return json(createProtection(db, human, { walletId: String(body.walletId ?? ""), label: String(body.label ?? ""), amount: body.amount }, now), 201);
  }
  if (request.method === "PATCH" && a === "protections" && b) {
    return json(updateProtection(db, human, b, { amount: body.amount, state: body.state as "ACTIVE" | "DISABLED" | undefined, expectedVersion: Number(body.expectedVersion) }, now));
  }
  if (request.method === "GET" && a === "products") return json({ products: listProducts(db, human, new URL(request.url).searchParams.get("search") ?? "") });
  if (request.method === "GET" && a === "merchants") return json({ merchants: listMerchants(db, human, typeof body.search === "string" ? body.search : request.url.includes("search=") ? new URL(request.url).searchParams.get("search") ?? undefined : undefined) });
  if (request.method === "POST" && a === "merchants" && b === "sync") return json(await syncMerchants(db, human, now, body.prepareSandbox === true));
  if (request.method === "POST" && a === "merchants" && b === "confirm-suggestions") return json(confirmSuggestedMerchantCategories(db, human, body.merchants, now));
  if (request.method === "PATCH" && a === "merchants" && b) {
    return json(confirmMerchantCategory(db, human, b, String(body.category ?? "") as MerchantCategory, now));
  }
  if (request.method === "GET" && a === "registrations" && !b) return json({ registrations: listRegistrations(db, human) });
  if (request.method === "POST" && a === "registrations" && !b) {
    return json(createRegistration(db, human, {
      name: String(body.name ?? ""),
      purpose: String(body.purpose ?? ""),
      walletIds: Array.isArray(body.walletIds) ? body.walletIds.map(String) : [],
      controllerUserId: typeof body.controllerUserId === "string" ? body.controllerUserId : undefined,
    }, now), 201);
  }
  if (request.method === "GET" && a === "registrations" && b && !c) return json(getRegistration(db, human, b));
  if (request.method === "PATCH" && a === "registrations" && b) {
    return json(updateRegistration(db, human, b, { name: optionalString(body.name), purpose: optionalString(body.purpose), expectedVersion: Number(body.expectedVersion) }, now));
  }
  if (request.method === "POST" && a === "registrations" && b && c === "pause") return json(pauseRegistration(db, human, b, now));
  if (request.method === "POST" && a === "registrations" && b && c === "resume") return json(resumeRegistration(db, human, b, now));
  if (request.method === "POST" && a === "registrations" && b && c === "archive") return json(archiveRegistration(db, human, b, now));
  if (request.method === "POST" && a === "registrations" && b && c === "connections") {
    const created = createConnection(db, human, b, body.mode === "PERSONAL_TOKEN" ? "PERSONAL_TOKEN" : "OAUTH", now);
    if (created.authMode === "OAUTH") {
      run(db, "UPDATE connections SET state = 'PENDING' WHERE id = ?", [created.id]);
      try {
        await auth.api.adminCreateOAuthResource({
          body: { identifier: created.resourceUri, name: `Sentinel connection ${created.id}`, allowedScopes: created.scopes },
          headers: resourceAdminHeaders(request.headers),
        });
        atomic(db, () => {
          requireHuman(db, human);
          const current = row(db, "SELECT state FROM connections WHERE id = ?", [created.id]);
          if (!current || text(current.state) !== "PENDING") throw unavailable("CONNECTION_CANCELLED", "The connection was cancelled during setup.");
          run(db, "UPDATE connections SET state = 'ACTIVE' WHERE id = ?", [created.id]);
        });
      } catch {
        run(db, "UPDATE connections SET state = 'REVOKED', token_hash = NULL WHERE id = ?", [created.id]);
        throw unavailable("OAUTH_RESOURCE_SETUP", "OAuth resource setup failed. This connection was revoked; create a new one after checking server configuration.");
      }
    }
    return json(created, 201);
  }
  if (request.method === "POST" && a === "connections" && b && c === "revoke") return json(revokeConnection(db, human, b, now));
  if (request.method === "GET" && a === "mandates") return json({ mandates: listMandates(db, human) });
  if (request.method === "POST" && a === "mandates" && !b) return json(createMandate(db, human, mandateInput(body), now, idempotencyKey(request)), 201);
  if (request.method === "POST" && a === "mandates" && b && c === "revoke") return json(revokeMandate(db, human, b, now));
  if (request.method === "POST" && a === "mandates" && b && c === "replace") return json(replaceMandate(db, human, b, mandateInput(body), now));
  if (request.method === "GET" && a === "tasks" && !b) return json({ tasks: listTasks(db, human) });
  if (request.method === "POST" && a === "tasks" && !b) {
    return json(createTask(db, human, {
      registrationId: String(body.registrationId ?? ""),
      kind: body.kind === "PURCHASE" ? "PURCHASE" : "RESEARCH",
      title: String(body.title ?? ""),
      requestedOutcome: String(body.requestedOutcome ?? ""),
      mandateId: typeof body.mandateId === "string" ? body.mandateId : null,
      requestKey: idempotencyKey(request),
    }, now), 201);
  }
  if (request.method === "GET" && a === "tasks" && b && !c) return json(getTask(db, human, b));
  if (request.method === "POST" && a === "tasks" && b && c === "instructions") {
    return json(queueInstruction(db, human, b, String(body.text ?? ""), "HUMAN_UI", now, idempotencyKey(request)), 201);
  }
  if (request.method === "POST" && a === "tasks" && b && c === "cancel") return json(cancelTask(db, human, b, now));
  if (request.method === "GET" && a === "proposals" && !b) return json({ proposals: listProposals(db, human) });
  if (request.method === "GET" && a === "proposals" && b && !c) return json(getProposal(db, human, b));
  if (request.method === "POST" && a === "proposals" && b && c === "recheck") return json(await recheckBlockedProposal(db, human, b, String(body.termsHash ?? "")));
  if (request.method === "POST" && a === "proposals" && b && c === "approve") return json(approveProposal(db, human, b, String(body.termsHash ?? ""), now));
  if (request.method === "POST" && a === "proposals" && b && c === "reject") return json(rejectProposal(db, human, b, String(body.termsHash ?? ""), now));
  if (request.method === "POST" && a === "proposals" && b && c === "cancel") return json(cancelProposal(db, human, b, now));
  if (request.method === "POST" && a === "proposals" && b && c === "reconcile") return json(queueReconcile(db, human, b, now));
  if (request.method === "GET" && a === "events") {
    const cursor = new URL(request.url).searchParams.get("cursor");
    return json(listEvents(db, human, cursor ? Number(cursor) : null, 30));
  }
  if (request.method === "GET" && a === "activity-graph") {
    return json(activityGraph(db, human, new URL(request.url).searchParams.get("taskId") ?? undefined));
  }
  if (request.method === "GET" && a === "authority-drafts" && b) return json(getAuthorityDraft(db, human, b));
  if (request.method === "POST" && a === "authority-drafts" && b && c === "confirm") {
    return json(confirmAuthorityDraft(db, human, b, now));
  }
  throw notFound("That Sentinel route does not exist.");
}

function mandateInput(body: Record<string, unknown>): MandateInput {
  const categories = Array.isArray(body.allowedCategories) ? body.allowedCategories.map(String) : [];
  return {
    registrationId: String(body.registrationId ?? ""),
    walletId: String(body.walletId ?? ""),
    totalAllowance: body.totalAllowance,
    perPurchaseLimit: body.perPurchaseLimit,
    reviewAbove: body.reviewAbove,
    allowedCategories: categories.filter((category): category is MerchantCategory => CATEGORIES.includes(category as MerchantCategory)),
    allowedMerchantIds: Array.isArray(body.allowedMerchantIds) ? body.allowedMerchantIds.map(String) : null,
    executionMode: body.executionMode === "AUTO_WITHIN_LIMITS" ? "AUTO_WITHIN_LIMITS" : "PROPOSE_ONLY",
    expiresAt: Number(body.expiresAt),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; slug?: string[] }> }) {
  try {
    const { workspaceId, slug = [] } = await context.params;
    return await handle(request, workspaceId, slug);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; slug?: string[] }> }) {
  try {
    const { workspaceId, slug = [] } = await context.params;
    return await handle(request, workspaceId, slug);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ workspaceId: string; slug?: string[] }> }) {
  try {
    const { workspaceId, slug = [] } = await context.params;
    return await handle(request, workspaceId, slug);
  } catch (error) {
    return errorResponse(error);
  }
}
