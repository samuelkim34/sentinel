# User-created Grok Bots and MCP

Create your native Bot in Grok. Sentinel stores a registration and its shared financial/task permissions. It neither starts a substitute text-model loop nor imports a native Bot's private chat or memory.

## Connect your Bot

1. Deploy Sentinel at a stable HTTPS origin for a remote native client. Local HTTP works for local development when the client accepts it; a cloud client cannot reach your private loopback server.
2. Create the Bot in the installed Grok Bot app, giving it your name, purpose, and instructions. The exact menu wording depends on that native client version.
3. In Sentinel's Bots page, save the corresponding registration. Register business Bots under their controller's account.
4. Open setup and click **Create OAuth connection**. Wait for success and copy its exact `/mcp/CONNECTION_ID` URL.
5. If the native client performs OAuth dynamic registration, the operator sets `ENABLE_MCP_DCR=true` and restarts Sentinel. DCR is false on a fresh setup. The client must use PKCE; HTTP loopback callbacks register as a native application.
6. Add the URL as a remote MCP server in the native Bot's connector settings. Sign in with the same Sentinel person who controls the registration.
7. On consent, verify the workspace, registration, granted accounts, and requested scopes. Consent does not create an allowance or approval authority.
8. Ask the Bot to call `get_context` and explain the actual returned permissions. This marks the connection verified and unlocks voice when xAI is configured.
9. Create a research task and ask the Bot to call `get_next_task`, read the task/instructions, and report progress. Purchase work also needs an active mandate granted by an owner.

The actual native Grok app was not connected during this review. The app's OAuth code flow, consent browser UI, PKCE exchange, MCP authentication and revocation were exercised by a test client. Verify native-client compatibility with your installed version before relying on unattended tasks.

## Suggested instructions

The registration detail page produces instructions you can paste into your Bot. Keep these rules:

- Use this connection's `get_context` and `get_next_task`; operate only on tasks it returns.
- Preserve the lease token and revision on every update/proposal.
- Report instructions as queued, acknowledged or applied according to stored server state.
- Use `list_merchants` and its server-confirmed categories. Explain amounts, evidence, and uncertainty.
- Treat a proposal or reservation as work in progress. A payment is complete only when Sentinel records a matching completed receipt.
- Ask a human when blocked. Changing your prompt, routine or reasoning cannot raise the mandate.
- Use `complete_research` for research output. Purchase completion is driven by settlement.

A native Grok routine may poll for tasks. Sentinel's worker settles authorized financial jobs; it does not call an LLM to make your native Bot reason.

## Credential modes and OAuth decisions

OAuth is used for business connections. Tokens must be for the exact connection URL and their subject must match its controller. Each request also checks current membership and revocation. A resource belonging to another person may not be used even if a token was issued after unrelated consent.

The provider's `enforcePerClientResources` option is explicitly false because per-connection resources are created before the native client's identity is known. This allows a registered client to request a resource through consent. Application-level issuer/audience/user/connection checks remain mandatory. Resource creation requires both the signed-in human session and the internal server privilege header.

A personal workspace controller can use a compatibility bearer token, shown once and stored only as a hash. It is a transferable credential, not proof of the physical native Bot using it. Business workspaces reject that mode.

Consent may include `proposals:write` before a mandate is granted, avoiding a permanently read-only connection. Actually using that scope requires a current unexpired mandate, and the proposal domain checks exact authority again. Task updates and reads still use their own scopes.

Creating another connection does not revoke older connections. Revoke each credential you stop using. Pause/archive the registration to stop its eligible unsubmitted work across connections. Already submitted purchases require reconciliation.
