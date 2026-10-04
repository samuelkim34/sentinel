import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";

// Model a separate client so other browser tests do not consume this client's
// production sign-in rate limit. The application's rate limiter stays enabled.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "192.0.2.33" } });

test("a business owner's browser completes sign-in, consent and PKCE for its MCP connection", async ({ page, request }) => {
  const origin = "http://127.0.0.1:43119";
  const email = `oauth-${Date.now()}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("OAuth owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Workspace name").fill("OAuth business");
  await page.getByRole("combobox", { name: "Kind", exact: true }).selectOption("BUSINESS");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  const workspaceId = new URL(page.url()).pathname.split("/")[2];
  await page.getByRole("link", { name: "Bots", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("User-created registration");
  await page.getByLabel("Purpose").fill("Check the connection consent flow");
  await page.getByRole("button", { name: "Save registration" }).click();
  await page.getByRole("link", { name: "Open setup" }).click();
  await expect(page.getByRole("button", { name: "Create personal token" })).toHaveCount(0);
  const creation = page.waitForResponse((response) => response.url().includes("/connections") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create OAuth connection" }).click();
  const creationResponse = await creation;
  expect(creationResponse.status()).toBe(201);
  const connection = await creationResponse.json() as { id: string; resourceUri: string };
  await expect(page.getByText(connection.resourceUri, { exact: true })).toBeVisible();

  // The anonymous API context models a native MCP client, not the owner's browser.
  const redirectUri = "http://127.0.0.1:49999/callback";
  const registered = await request.post(`${origin}/api/auth/oauth2/register`, { data: { client_name: "Browser flow test client", application_type: "native", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope: "context:read tasks:read tasks:update proposals:write" } });
  expect(registered.status()).toBe(201);
  const client = await registered.json() as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", scope: "context:read tasks:read tasks:update proposals:write", resource: connection.resourceUri, state: "browser-fixture-state", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await page.route(`${redirectUri}**`, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "Test native client received the code" }));
  await page.goto(`${origin}/api/auth/oauth2/authorize?${query}`);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect a Grok Bot" })).toBeVisible();
  await expect(page.getByText("OAuth business", { exact: true })).toBeVisible();
  await expect(page.getByText("User-created registration", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Allow this connection" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:49999\/callback\?/);
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe("browser-fixture-state");
  const code = callback.searchParams.get("code");
  expect(code).toBeTruthy();
  const exchange = await request.post(`${origin}/api/auth/oauth2/token`, { form: { grant_type: "authorization_code", client_id: client.client_id, redirect_uri: redirectUri, code: code!, code_verifier: verifier, resource: connection.resourceUri } });
  expect(exchange.status()).toBe(200);
  const token = await exchange.json() as { access_token: string };
  const headers = { authorization: `Bearer ${token.access_token}`, accept: "application/json, text/event-stream" };
  const initialize = await request.post(connection.resourceUri, { headers, data: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "Browser flow fixture", version: "1.0" } } } });
  expect(initialize.status()).toBe(200);
  expect(await initialize.text()).toMatch(/sentinel/i);
  const revoke = await page.request.post(`${origin}/api/workspaces/${workspaceId}/connections/${connection.id}/revoke`, { headers: { origin }, data: {} });
  expect(revoke.status()).toBe(200);
  const invalidated = await request.post(connection.resourceUri, { headers, data: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } });
  expect(invalidated.status()).toBe(401);
});
