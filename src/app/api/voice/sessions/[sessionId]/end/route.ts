import { endVoiceSession } from "../../../../../../domain/voice";
import { assertOrigin, errorResponse, json, readJson, resolveHuman } from "../../../../../../server/http";
import { getDb } from "../../../../../../storage/db";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    assertOrigin(request);
    const body = await readJson(request);
    const human = await resolveHuman(request, String(body.workspaceId ?? ""));
    const { sessionId } = await context.params;
    return json(endVoiceSession(getDb(), human, sessionId, Date.now()));
  } catch (error) {
    return errorResponse(error);
  }
}
