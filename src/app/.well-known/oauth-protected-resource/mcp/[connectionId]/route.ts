import { CONNECTOR_SCOPES } from "../../../../../contracts/constants";
import { getEnv } from "../../../../../server/env";
import { json } from "../../../../../server/http";
import { getDb } from "../../../../../storage/db";
import { row, text } from "../../../../../storage/sql";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await context.params;
  const connection = row(getDb(), "SELECT resource_uri, state FROM connections WHERE id = ?", [connectionId]);
  if (!connection || text(connection.state) === "REVOKED") {
    return json({ error: { code: "NOT_FOUND", message: "That connector resource is not available.", requestId: connectionId } }, 404);
  }
  const origin = getEnv().APP_ORIGIN.replace(/\/$/, "");
  return json({
    resource: text(connection.resource_uri),
    authorization_servers: [`${origin}/api/auth`],
    scopes_supported: CONNECTOR_SCOPES,
    bearer_methods_supported: ["header"],
  });
}
