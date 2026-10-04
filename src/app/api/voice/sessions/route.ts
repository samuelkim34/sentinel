import { createVoiceSession, setTranscriptRetention } from "../../../../domain/voice";
import { assertOrigin, errorResponse, json, readJson, resolveHuman } from "../../../../server/http";
import { getDb } from "../../../../storage/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const body = await readJson(request);
    const human = await resolveHuman(request, String(body.workspaceId ?? ""));
    if (body.retainVoiceTranscripts !== undefined) {
      return json(setTranscriptRetention(getDb(), human.userId, Boolean(body.retainVoiceTranscripts)));
    }
    return json(await createVoiceSession(getDb(), human, {
      registrationId: String(body.registrationId ?? ""),
      taskId: typeof body.taskId === "string" ? body.taskId : undefined,
    }, Date.now()), 201);
  } catch (error) {
    return errorResponse(error);
  }
}
