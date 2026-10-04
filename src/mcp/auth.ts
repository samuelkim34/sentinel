import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { AppError } from "../contracts/errors";
import { loadMembership, type ConnectorContext } from "../domain/access";
import { hashesEqual, sha256 } from "../domain/ids";
import { getEnv } from "../server/env";
import { auth } from "../server/auth/config";
import { row, run, text } from "../storage/sql";
import { getDb } from "../storage/db";

const resourceClient = oauthProviderResourceClient(auth);

export async function authenticateConnector(request: Request, connectionId: string): Promise<ConnectorContext> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new AppError(401, "UNAUTHENTICATED", "A connector credential is required.");
  const db = getDb();
  const connection = row(db, "SELECT * FROM connections WHERE id = ?", [connectionId]);
  if (!connection || text(connection.state) !== "ACTIVE") {
    throw new AppError(401, "CONNECTION_REVOKED", "This connection has been revoked.");
  }
  const resource = text(connection.resource_uri);
  let scopes: string[] = [];
  if (token.startsWith("snt_")) {
    if (!hashesEqual(text(connection.token_hash), sha256(token)) || text(connection.auth_mode) !== "PERSONAL_TOKEN") {
      throw new AppError(401, "CONNECTION_REVOKED", "This personal token is not valid for the connection.");
    }
    scopes = JSON.parse(text(connection.scopes)) as string[];
  } else {
    if (text(connection.auth_mode) !== "OAUTH") throw new AppError(401, "TOKEN_REJECTED", "This connection requires its personal credential.");
    let payload: { scope?: unknown; sub?: unknown };
    try {
      payload = await resourceClient.getActions().verifyAccessTokenRequest(request, {
        verifyOptions: {
          audience: resource,
          issuer: `${getEnv().BETTER_AUTH_URL}/api/auth`,
        },
        jwksUrl: `${getEnv().BETTER_AUTH_URL}/api/auth/jwks`,
      });
    } catch {
      throw new AppError(401, "TOKEN_REJECTED", "The connector token was rejected.");
    }
    const tokenScopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    const bound = new Set(JSON.parse(text(connection.scopes)) as string[]);
    scopes = tokenScopes.filter((scope) => bound.has(scope));
    if (typeof payload.sub !== "string" || payload.sub !== text(connection.user_id)) {
      throw new AppError(401, "TOKEN_REJECTED", "The connector token is for a different person.");
    }
  }
  const current = row(db, "SELECT state, user_id, registration_id FROM connections WHERE id = ?", [connectionId]);
  if (!current || text(current.state) !== "ACTIVE" || text(current.user_id) !== text(connection.user_id) || text(current.registration_id) !== text(connection.registration_id)) {
    throw new AppError(401, "CONNECTION_REVOKED", "This connection is no longer active.");
  }
  const member = loadMembership(db, text(connection.workspace_id), text(connection.user_id));
  if (!member || member.state !== "ACTIVE") throw new AppError(401, "MEMBERSHIP_REQUIRED", "Workspace membership is no longer active.");
  const registration = row(db, "SELECT state FROM registrations WHERE id = ?", [text(connection.registration_id)]);
  if (!registration || text(registration.state) === "ARCHIVED") {
    throw new AppError(401, "CONNECTION_REVOKED", "This registration is archived.");
  }
  const mandate = row(
    db,
    "SELECT id FROM mandates WHERE registration_id = ? AND state = 'ACTIVE' AND expires_at > ?",
    [text(connection.registration_id), Date.now()],
  );
  const live = new Set(scopes.filter((scope) => scope !== "proposals:write" || mandate));
  run(db, "UPDATE connections SET last_seen_at = ? WHERE id = ? AND state = 'ACTIVE'", [Date.now(), connectionId]);
  return {
    kind: "connector",
    userId: text(connection.user_id),
    workspaceId: text(connection.workspace_id),
    registrationId: text(connection.registration_id),
    connectionId,
    scopes: live,
  };
}
