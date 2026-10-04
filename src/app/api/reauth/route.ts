import { AppError } from "../../../contracts/errors";
import { auth } from "../../../server/auth/config";
import { assertOrigin, errorResponse, json, readJson, resolveHuman } from "../../../server/http";
import { getDb } from "../../../storage/db";
import { run } from "../../../storage/sql";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const human = await resolveHuman(request);
    const body = await readJson(request);
    const password = String(body.password ?? "");
    const result = await auth.api.verifyPassword({ body: { password }, headers: request.headers });
    if (!result.status) throw new AppError(401, "REAUTHENTICATION_FAILED", "The password did not match.");
    const expiresAt = Date.now() + 5 * 60 * 1000;
    run(getDb(), "INSERT INTO reauth_grants (session_id, user_id, expires_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET expires_at = excluded.expires_at, user_id = excluded.user_id", [
      human.sessionId, human.userId, expiresAt,
    ]);
    return json({ reauthenticatedUntil: expiresAt });
  } catch (error) {
    return errorResponse(error);
  }
}
