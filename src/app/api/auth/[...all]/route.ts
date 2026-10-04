import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../../server/auth/config";
import { getDb } from "../../../../storage/db";
import { atomic, run } from "../../../../storage/sql";

export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;
export async function POST(request: Request) {
  const signingOut = new URL(request.url).pathname === "/api/auth/sign-out";
  const session = signingOut ? await auth.api.getSession({ headers: request.headers }) : null;
  const response = await handlers.POST(request);
  if (signingOut && response.ok && session) atomic(getDb(), () => {
    run(getDb(), "DELETE FROM reauth_grants WHERE session_id = ?", [session.session.id]);
  });
  return response;
}
