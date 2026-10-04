# HTTP and MCP API

Human routes use Better Auth session cookies and live workspace membership. Mutating human requests require an exact configured `Origin`. Development loopback aliases are limited to the configured scheme/port; request Host/forwarded Host headers do not grant trust. JSON object bodies are limited to 1 MiB; malformed bodies return 422 and oversized bodies 413.

Money form fields use ordinary decimal USD strings such as `"25.00"`. Connector proposals use checked integer `amountCents`. IDs, permissions, versions and exact terms hashes remain server-controlled. An idempotency key is 1–200 characters; supported actions bind it to the request body and replay unchanged results, rejecting changed terms.

## Global routes

| Route | Contract |
| --- | --- |
| `/api/auth/*` | Better Auth session and OAuth endpoints |
| `GET/POST /api/workspaces` | List memberships / create personal or business workspace |
| `POST /api/reauth` | `{password}`; five-minute session-bound grant |
| `POST /api/invitations/:token/accept` | Signed-in recipient, one-time valid invitation |
| `GET/PUT /api/preferences` | `{retainVoiceTranscripts: boolean}` |
| `GET /api/configuration` | Provider/configuration flags, never keys |
| `GET /api/health` | Web liveness |
| `GET /api/oauth/preview?resource=...` | Current user's active OAuth connection/permission preview |
| `GET /api/source.zip` | Configured GitHub default-branch ZIP redirect, or configuration error |

## Workspace routes

These suffixes are under `/api/workspaces/:workspaceId`. Domain checks determine permission; a UI button is not authority.

| Method and suffix | Main rule |
| --- | --- |
| `GET /overview`, `/events`, `/activity-graph` | Active member; visible work only |
| `GET /members` | Owner/finance |
| `PATCH /members/:userId` | Owner, expectedVersion; fresh auth for authority escalation; last owner protected |
| `POST /invitations` | Business owner; fresh auth for owner/finance role |
| `GET /banking/customers` | Owner; operator-permitted customer candidates |
| `POST /banking/link` | Owner; permitted customer and upstream account membership |
| `POST /banking/provision` | Owner and fresh password grant; creates/readbacks sandbox customer/account |
| `GET /accounts`, `/accounts/:walletId` | Active member, account visibility checks |
| `POST /accounts/:walletId/refresh` | Authorized account refresh with identity/version checks |
| `POST /accounts/:walletId/baseline` | Owner and fresh auth; fresh observation, no unresolved operation |
| `POST /protections`, `PATCH /protections/:id` | Owner and fresh auth; state/version/funds checks |
| `GET /merchants`, `POST /merchants/sync` | Catalog read / owner sync |
| `PATCH /merchants/:id` | Owner category confirmation for this workspace |
| `GET/POST /registrations` | Permitted list / controlled registration; owner-only business read grants |
| `GET/PATCH /registrations/:id` | Visible registration / control and version checks |
| `POST /registrations/:id/pause`, `/resume`, `/archive` | Role/controller checks and corresponding work lifecycle |
| `POST /registrations/:id/connections` | Controlled Bot; OAuth resource setup or personal-workspace token |
| `POST /connections/:id/revoke` | Controller, owner or finance revocation |
| `GET/POST /mandates` | Permitted list / owner and fresh auth, exact bounded terms |
| `POST /mandates/:id/revoke`, `/replace` | Owner; replacement also requires fresh auth |
| `GET/POST /tasks` | Visible list / controller or owner; purchases need current mandate |
| `GET /tasks/:id` | Task, instructions, updates and proposals within visibility |
| `POST /tasks/:id/instructions`, `/cancel` | Visible/control-authorized work; no cancel of submitted payments |
| `GET /proposals`, `/proposals/:id` | Visible proposals |
| `POST /proposals/:id/approve`, `/reject` | Owner/finance and fresh auth, exact termsHash; business approval separation |
| `POST /proposals/:id/cancel` | Visible eligible unsubmitted proposal |
| `POST /proposals/:id/reconcile` | Owner/finance read-only bank-status job |
| `GET /authority-drafts/:id` | Bound visible draft |
| `POST /authority-drafts/:id/confirm` | Owner, fresh auth, unexpired pending exact terms |

Example mandate body:

```json
{
  "registrationId": "your-registration-id",
  "walletId": "your-wallet-id",
  "totalAllowance": "200.00",
  "perPurchaseLimit": "50.00",
  "reviewAbove": "25.00",
  "allowedCategories": ["OFFICE"],
  "allowedMerchantIds": null,
  "executionMode": "PROPOSE_ONLY",
  "expiresAt": 1800000000000
}
```

Choose a real future expiry at submission time; this example is a shape, not a seeded grant.

## Voice routes

`POST /api/voice/sessions` takes `{workspaceId, registrationId, taskId?}` and returns the short-lived session credential, tool token, allowed functions and audio setup. An active on-site agent connection (or a legacy verified connection) and configured xAI key are required.

`POST /api/voice/sessions/:sessionId/tools` takes `{workspaceId, callId, name, arguments}` and the `x-sentinel-voice-token` header. It requires the current cookie session and exact bound targets. Duplicate identical call IDs replay; changed arguments conflict.

`POST .../:sessionId/end` takes `{workspaceId}`. `POST .../:sessionId/transcript` takes `{workspaceId, speaker, text, final:true}`, the tool token, and requires active opt-in retention to store text.

## MCP and OAuth discovery

The actual MCP endpoint is **`/mcp/:connectionId`**, using a personal bearer credential or resource-bound OAuth access token. An unauthenticated request returns a protected-resource metadata challenge.

- Protected resource: `/.well-known/oauth-protected-resource/mcp/:connectionId`
- Authorization metadata: `/.well-known/oauth-authorization-server/api/auth` and root compatibility route
- Issuer: canonical origin plus `/api/auth`
- Provider endpoints: `/api/auth/oauth2/authorize`, `/token`, `/register`, `/consent`

The ten tools are `get_context`, `list_merchants`, `get_next_task`, `get_task`, `get_agent_state`, `update_task`, `acknowledge_instruction`, `revise_plan`, `submit_proposal`, and `complete_research`. Mutations require a matching task revision and connection-bound lease. No purchase approval, raw banking, arbitrary fetch/SQL, or direct payment tool is registered.

## On-site agent routes

All paths below are under `/api/workspaces/:workspaceId`. Creation/edit/chat/conversion require the current owner or the agent’s controller where applicable. Finance may read permitted shared work, but cannot read another user’s private chat.

| Method and suffix | Body / response |
| --- | --- |
| `POST /agents` | `{name, purpose, instructions?, walletIds?}`; creates on-site profile/internal connection, supports Idempotency-Key |
| `PATCH /agents/:registrationId` | Same profile fields plus `expectedVersion`; owner-only changes to business read grants |
| `POST /agents/:registrationId/enable` | `{instructions?}`; converts safe legacy registration and revokes external execution |
| `GET /agents/runtime` | Key-configured flag, model, worker heartbeat; never a credential |
| `GET /agents/:registrationId/chat` | Current user’s recent messages, own chat runs and visible agent task runs |
| `POST /agents/:registrationId/chat` | `{text, mandateId?}`; atomic message and queued run, 202, supports Idempotency-Key |
| `POST /agents/:registrationId/retry` | `{runId}`; explicit safe retry of a failed visible run, 202 |

Registration responses add `executionMode` (`ONSITE`/`EXTERNAL`), `agentInstructions` and `agentReady`. Readiness means an active configured internal execution connection, not a completed live provider acceptance test. Provider configuration is reported separately.

Registration detail's `setup.connectionId` refers only to an active or pending external connection. It is null after revocation and for an on-site internal connection. `setup.connectionState` reports the current external state or the last external state, allowing the UI to display a confirmed revoked status after reload.

Text chat tools: `get_agent_state`, `list_merchants`, `get_task`, `queue_instruction`, `create_task`. Task tools: the three factual reads plus `update_task`, `acknowledge_instruction`, `revise_plan`, `submit_proposal`, `complete_research`. Task tool identity/lease fields are injected by the server, never model-supplied. A selected mandate is bound to one chat run; omitted selection forbids purchase task creation. External connection creation is refused for on-site profiles; their internal identities cannot authenticate to MCP.
