import { executeVoiceTool } from "../../../../../../domain/voice";
import { AppError } from "../../../../../../contracts/errors";
import { assertOrigin, errorResponse, json, readJson, resolveHuman } from "../../../../../../server/http";
import { getDb } from "../../../../../../storage/db";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    assertOrigin(request);
    const body = await readJson(request);
    const human = await resolveHuman(request, String(body.workspaceId ?? ""));
    const token = request.headers.get("x-sentinel-voice-token") ?? "";
    if (!token) throw new AppError(401, "VOICE_TOKEN", "A voice tool token is required.");
    const { sessionId } = await context.params;
    const args = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
      ? body.arguments as Record<string, unknown>
      : {};
    return json(executeVoiceTool(getDb(), human, sessionId, token, {
      callId: String(body.callId ?? ""),
      name: String(body.name ?? ""),
      arguments: args,
    }, Date.now()));
  } catch (error) {
    return errorResponse(error);
  }
}
