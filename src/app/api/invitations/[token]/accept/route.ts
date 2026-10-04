import { acceptInvitation } from "../../../../../domain/workspaces";
import { assertOrigin, errorResponse, json, resolveHuman } from "../../../../../server/http";
import { getDb } from "../../../../../storage/db";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    assertOrigin(request);
    const human = await resolveHuman(request);
    const { token } = await context.params;
    return json(acceptInvitation(getDb(), human.userId, token, Date.now()));
  } catch (error) {
    return errorResponse(error);
  }
}
