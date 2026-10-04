import { getTranscriptRetention, setTranscriptRetention } from "../../../domain/voice";
import { assertOrigin, errorResponse, json, readJson, resolveHuman } from "../../../server/http";
import { getDb } from "../../../storage/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const human = await resolveHuman(request);
    return json(getTranscriptRetention(getDb(), human.userId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertOrigin(request);
    const human = await resolveHuman(request);
    const body = await readJson(request);
    return json(setTranscriptRetention(getDb(), human.userId, body.retainVoiceTranscripts === true));
  } catch (error) {
    return errorResponse(error);
  }
}
