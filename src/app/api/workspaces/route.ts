import { createWorkspace, listWorkspaces } from "../../../domain/workspaces";
import { getDb } from "../../../storage/db";
import { assertOrigin, errorResponse, idempotencyKey, json, readJson, resolveHuman } from "../../../server/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const human = await resolveHuman(request);
    return json({ workspaces: listWorkspaces(getDb(), human.userId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const human = await resolveHuman(request);
    const body = await readJson(request);
    const kind = body.kind === "BUSINESS" ? "BUSINESS" : "PERSONAL";
    const created = createWorkspace(getDb(), human.userId, {
      kind,
      label: String(body.label ?? ""),
      timezone: String(body.timezone ?? "UTC"),
    }, Date.now(), idempotencyKey(request));
    return json(created, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
