# Integration status

| Surface | Implementation and verification boundary |
| --- | --- |
| On-site agent setup | Real persistent profiles, read grants, edit/version controls, legacy conversion; no seeded agents |
| Grok text execution | xAI Responses function calls, run queue/claims, task-bound domain tools, bounded requests and tool journal; controlled provider fixtures, live operator key required |
| Chat | Per-user history and original-message idempotency; no default purchase permission, explicit allowance selection |
| Voice | xAI ephemeral credentials, realtime PCM streaming, bound tools and same agent state; server/audio fixtures, live key and microphone required |
| Email/password auth | Better Auth and exact-origin controls; separate file-backed connection and immediate transactions prevent the observed worker/signup snapshot race |
| Nessie sandbox | Verified account bindings, observations, protected funds, mandates and purchase settlement; isolated adapter tests, live sandbox key required |
| Business teams | Owner/finance/member visibility, invitation links and approval separation; no outgoing messaging service |
| Optional legacy MCP | OAuth/token APIs, PKCE, scoped resources, revocation; converted on-site profiles reject external execution |
| GitHub/CI | Source and automated workflow supplied; no remote push or deployment performed by this handoff |
| Containers | Web, agent-worker and payment-worker share one persistent volume; Compose reviewed, Docker runtime unavailable here |

The runtime does not create native Grok-app bots. Users configure agents on-site; the operator configures provider access once. The supported financial action is a USD Nessie sandbox merchant purchase. There is no real Capital One customer login, production banking, retailer checkout or live web-search tool. Text run success is independent from task completion and bank receipt status.
