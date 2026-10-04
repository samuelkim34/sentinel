import assert from "node:assert/strict";
import { before, after, it } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { testEnv } from "./support";
import { resetEnvCache } from "../src/server/env";
import { createWorkspace } from "../src/domain/workspaces";
import { createRegistration, createConnection, revokeConnection } from "../src/domain/authority";
import { getDb, closeDb } from "../src/storage/db";
import { run } from "../src/storage/sql";
import type { HumanContext } from "../src/domain/access";

const base = "http://127.0.0.1:43117";
let auth: (typeof import("../src/server/auth/config"))["auth"];
let cookie = "";
let userId = "";
const password = "correct-horse-battery";
const originalFetch = globalThis.fetch;

async function request(path: string, body?: Record<string, unknown>, origin = base, forwarded?: string) {
  const headers = new Headers({ host: "127.0.0.1:43117", origin });
  if (body) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  if (forwarded) headers.set("x-forwarded-host", forwarded);
  return auth.handler(new Request(`${base}/api/auth/${path}`, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined }));
}

before(async () => {
  testEnv(); process.env.ENABLE_MCP_DCR = "true"; resetEnvCache();
  const config = await import("../src/server/auth/config"); auth = config.auth;
  const { getMigrations } = await import("better-auth/db/migration"); await (await getMigrations(config.authOptions)).runMigrations();
  const response = await request("sign-up/email", { name: "HTTP test owner", email: "http-owner@example.com", password });
  assert.equal(response.status, 200);
  cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  const result = await response.json(); userId = result.user.id;
});
after(() => { globalThis.fetch = originalFetch; closeDb(); });

it("sign-in works from the local alias after signup", async () => {
  const response = await request("sign-in/email", { email: "http-owner@example.com", password }, "http://localhost:43117");
  assert.equal(response.status, 200); assert.ok(response.headers.getSetCookie().length > 0);
});

it("untrusted origins stay rejected even with attacker-controlled forwarded hosts", async () => {
  const response = await request("sign-in/email", { email: "http-owner@example.com", password }, "https://evil.example", "evil.example");
  assert.equal(response.status, 403); assert.equal((await response.json()).code, "INVALID_ORIGIN");
  assert.equal(response.headers.getSetCookie().length, 0);
});

it("malformed and oversized human JSON returns a validation error", async () => {
  const { POST } = await import("../src/app/api/workspaces/route");
  for (const body of ["{", "[1,2]"]) {
    const response = await POST(new Request(`${base}/api/workspaces`, { method: "POST", headers: { origin: base, cookie, "content-type": "application/json" }, body }));
    assert.equal(response.status, 422);
  }
  const response = await POST(new Request(`${base}/api/workspaces`, { method: "POST", headers: { origin: base, cookie, "content-type": "application/json" }, body: "x".repeat(1048577) }));
  assert.equal(response.status, 413);
});

it("MCP responds with OAuth discovery metadata when a credential is missing", async () => {
  const { POST } = await import("../src/app/mcp/[connectionId]/route");
  const response = await POST(new Request(`${base}/mcp/unknown`, { method: "POST" }), { params: Promise.resolve({ connectionId: "unknown" }) });
  assert.equal(response.status, 401); assert.match(response.headers.get("www-authenticate") ?? "", /resource_metadata=.*oauth-protected-resource/);
});

it("explicitly enabled public OAuth registration accepts an anonymous native client and requires PKCE", async () => {
  const response = await auth.handler(new Request(`${base}/api/auth/oauth2/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Fixture MCP client", application_type: "native", redirect_uris: ["http://127.0.0.1:49999/callback"], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope: "context:read tasks:read tasks:update proposals:write" }) }));
  const client = await response.json(); assert.equal(response.status, 201, JSON.stringify(client)); assert.ok(client.client_id); assert.equal(client.client_secret, undefined);
  const authorization = await request(`oauth2/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: "http://127.0.0.1:49999/callback", response_type: "code", scope: "context:read", state: "fixture-state" })}`);
  assert.ok(authorization.status >= 400 || (authorization.headers.get("location") ?? "").includes("error="));
});

it("OAuth code exchange produces a resource-bound token accepted by MCP and invalidated on revoke", async () => {
  const config = await import("../src/server/auth/config"); const db = getDb(); const now = Date.now();
  const workspace = createWorkspace(db, userId, { kind: "BUSINESS", label: "OAuth test", timezone: "UTC" }, now);
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) }); assert.ok(session);
  const human: HumanContext = { kind: "human", workspaceId: workspace.id, userId, role: "owner", sessionId: session.session.id };
  const registration = createRegistration(db, human, { name: "OAuth fixture Bot", purpose: "Integration test only", walletIds: [] }, now);
  const connection = createConnection(db, human, registration.id, "OAUTH", now);
  await auth.api.adminCreateOAuthResource({ headers: config.resourceAdminHeaders(new Headers({ cookie })), body: { identifier: connection.resourceUri, name: "Fixture resource", allowedScopes: connection.scopes } });
  const client = await auth.api.adminCreateOAuthClient({ headers: new Headers({ cookie, origin: base }), body: { client_name: "Fixture approved client", application_type: "native", redirect_uris: ["http://127.0.0.1:49999/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"], scope: "context:read tasks:read tasks:update", require_pkce: true, skip_consent: true } });
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: "http://127.0.0.1:49999/callback", response_type: "code", scope: "context:read tasks:read tasks:update", resource: connection.resourceUri, state: "fixture-state", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
  const authorization = await request(`oauth2/authorize?${query}`);
  const location = authorization.headers.get("location"); assert.ok(location, `Expected a code redirect; received ${authorization.status}`);
  const code = new URL(location).searchParams.get("code"); assert.ok(code, location);
  const tokenResponse = await auth.handler(new Request(`${base}/api/auth/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: "http://127.0.0.1:49999/callback", code, code_verifier: verifier, resource: connection.resourceUri }) }));
  assert.equal(tokenResponse.status, 200); const token = await tokenResponse.json(); assert.ok(token.access_token);
  // Resolve this test issuer's JWKS in process without calling an external service.
  globalThis.fetch = async (input, init) => { const req = input instanceof Request ? input : new Request(input, init); if (new URL(req.url).origin === base) return auth.handler(req); return originalFetch(input, init); };
  const { authenticateConnector } = await import("../src/mcp/auth");
  const req = new Request(connection.resourceUri, { headers: { authorization: `Bearer ${token.access_token}` } });
  const ctx = await authenticateConnector(req, connection.id); assert.equal(ctx.userId, userId); assert.ok(ctx.scopes.has("context:read")); assert.equal(ctx.scopes.has("proposals:write"), false);
  revokeConnection(db, human, connection.id, Date.now()); await assert.rejects(authenticateConnector(req, connection.id));
  globalThis.fetch = originalFetch;
});

it("successful sign-out removes the password-confirmation grant", async () => {
  const db = getDb(); const session = await auth.api.getSession({ headers: new Headers({ cookie }) }); assert.ok(session);
  run(db, "INSERT INTO reauth_grants (session_id, user_id, expires_at) VALUES (?, ?, ?)", [session.session.id, userId, Date.now() + 60000]);
  const { POST } = await import("../src/app/api/auth/[...all]/route");
  const response = await POST(new Request(`${base}/api/auth/sign-out`, { method: "POST", headers: { origin: base, cookie, "content-type": "application/json" }, body: "{}" }));
  assert.equal(response.status, 200); assert.equal(db.prepare("SELECT COUNT(*) AS c FROM reauth_grants WHERE session_id = ?").get(session.session.id)?.c, 0);
});
