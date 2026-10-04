import { randomUUID } from "node:crypto";
import { AppError } from "../contracts/errors";
import { MoneyError } from "../contracts/money";
import { loadMembership, type HumanContext } from "../domain/access";
import { auth } from "./auth/config";
import { isTrustedOrigin } from "./origins";
import { getDb } from "../storage/db";
import { ZodError } from "zod";

export async function resolveHuman(request: Request, workspaceId?: string): Promise<HumanContext & { email: string; name: string }> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
  if (!workspaceId) {
    return {
      kind: "human",
      userId: session.user.id,
      workspaceId: "",
      role: "owner",
      sessionId: session.session.id,
      email: session.user.email,
      name: session.user.name,
    };
  }
  const member = loadMembership(getDb(), workspaceId, session.user.id);
  if (!member || member.state !== "ACTIVE") throw new AppError(404, "NOT_FOUND", "That workspace is not available.");
  return {
    kind: "human",
    userId: session.user.id,
    workspaceId,
    role: member.role,
    sessionId: session.session.id,
    email: session.user.email,
    name: session.user.name,
  };
}

export function assertOrigin(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  if (!isTrustedOrigin(request.headers.get("origin"))) {
    throw new AppError(403, "ORIGIN_REJECTED", "The request origin is not trusted.");
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function errorResponse(error: unknown): Response {
  const requestId = randomUUID();
  if (error instanceof AppError) {
    return json({ error: { code: error.code, message: error.message, requestId, details: error.details } }, error.status);
  }
  if (error instanceof MoneyError) {
    return json({ error: { code: error.code, message: error.message, requestId } }, 422);
  }
  if (error instanceof ZodError) return json({ error: { code: "INVALID_BODY", message: "Request fields do not match the required format.", requestId } }, 422);
  console.error(JSON.stringify({ requestId, name: error instanceof Error ? error.name : "Error" }));
  return json({ error: { code: "INTERNAL", message: "The request could not be completed.", requestId } }, 500);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const limit = 1_048_576;
  if (Number(request.headers.get("content-length")) > limit) throw new AppError(413, "BODY_TOO_LARGE", "The request body is too large.");
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new AppError(413, "BODY_TOO_LARGE", "The request body is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new AppError(422, 'INVALID_BODY', 'Expected valid JSON.'); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(422, "INVALID_BODY", "Expected a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function idempotencyKey(request: Request): string | undefined {
  const key = request.headers.get("idempotency-key") ?? undefined;
  if (key !== undefined && (!key.trim() || key.length > 200)) throw new AppError(422, 'INVALID_IDEMPOTENCY_KEY', 'Use an idempotency key of 1 to 200 characters.');
  return key;
}
