# Create and operate Grok-powered agents on-site

The operator configures one server-side xAI key. Each user creates an agent through Sentinel's Bots page with a name, purpose, custom instructions and account read grants. Sentinel persists this identity and runs Grok through the Responses API. It does not create a native bot in the external Grok app, and users do not configure external connectors.

## User flow

1. Create a Sentinel account and workspace.
2. Open Bots and choose Create an agent. The controller is the creating user. Business users can create their own agents, but only an owner can grant account access.
3. Open the agent and edit its name, purpose, instructions and granted accounts. Changing preferences never changes spending authority. Removing read access under a current allowance is refused until that allowance is revoked.
4. Use chat for questions and explicit work requests. The default permits research and conversation. For a purchase request, select an existing owner-granted allowance for that specific message.
5. Create tasks manually when you prefer exact control over task kind, outcome and allowance. On-site agents pick eligible tasks up automatically while active.
6. Inspect Recent agent runs and the task's recorded updates, instruction status and proposals. A successful Grok run means that the model run finished, not that a purchase settled.

Text conversations are stored per user and agent. Other authorized workspace members see shared task actions and task-run summaries, not your chat messages. The last 24 chat messages at or before the current request are provided to the text model. Task runs do not receive a controller's private chat.

## Operator configuration

Set `XAI_API_KEY` in `.env.local`, keep it private, and restart Sentinel. `XAI_AGENT_MODEL` defaults to `grok-4.7`; choose another supported Grok model if your account requires it. This model must support the Responses API and function calls.

`npm run dev` and `npm start` supervise all three processes. The chat panel shows configured model and agent-worker heartbeat. A missing key prevents chat insertion. A stopped worker leaves already accepted requests queued. Provider/model-access/rate-limit failures produce an explicit failed run with recorded tool activity; no fake response or completion is inserted.

A workspace can have 20 unarchived on-site agents. Chat is limited to 10 new requests per user/minute and 20 pending runs per agent. Workspace run limits and model budgets are configurable:

| Variable | Default | Allowed range |
| --- | --- | --- |
| `AGENT_DAILY_RUN_LIMIT` | 200 per workspace per rolling 24 hours | 1–10,000 |
| `AGENT_MAX_STEPS` | 6 requests per run | 1–12 |
| `AGENT_MAX_TOOL_CALLS` | 20 per run | 1–40 |
| `AGENT_MAX_OUTPUT_TOKENS` | 2048 per request | 128–8192 |
| `AGENT_REQUEST_TIMEOUT_SECONDS` | 45 | 5–120 |

These are execution bounds, not a guaranteed dollar-cost cap. xAI bills the operator's account. Configure its provider-side spending controls for your intended deployment. The worker runs one model job at a time per process, and the database permits only one running job per agent. Operate one agent-worker instance for this deployment.

## Existing registrations

Open an old registration and choose Enable on-site agent. The server checks owner/controller authority, preserves the registration and its permissions, and replaces execution with a credential-free internal principal. Conversion refuses live external leases and review/reserved/submitted financial work; finish or cancel eligible work first. Previous external connections are revoked, and cannot be used to operate the converted agent.

Internal principals are not bearer credentials or public MCP endpoints. External OAuth/token APIs remain for legacy development integrations, but the default agent UI does not create them. New external connections for on-site agents are rejected. No native-client private memory is imported during conversion.

## Tool behavior

Chat can read current agent state, query synced merchants, read its own agent's tasks, queue requested instructions and create one requested task per chat message. It cannot submit purchase proposals. A purchase task created by chat uses only the allowance explicitly selected by the human.

Task runs obtain a short-lived lease and use task-bound tools to record progress, acknowledge/apply instructions, revise an uncommitted plan, propose a purchase, or complete research. Identity, task ID, revision and lease are injected by the server. The model cannot choose another task, controller or workspace for mutations. Outstanding instructions must be recorded as applied before a purchase proposal. New instructions can restart a task waiting for review or blocked before submission; revised terms require a new policy decision and approval where applicable.

Tools never approve payments, expand authority, execute SQL, browse arbitrary URLs or call the bank directly. The agent worker refreshes a stale purchase account through the authorized server banking adapter before claiming financial work. The payment worker independently revalidates policy and receipts.

## Failures and retry

Review tool activity before choosing Review done — retry run. Retries reuse the original chat message's task/instruction idempotency keys. A stale worker claim cannot mutate state. Interrupted runs are failed without automatic replay. Financial tasks with existing commitments cannot be retried through the run button; use their normal review/reconciliation controls. Task notes are model-reported statements, and receipts remain authoritative for payment completion.

Provider reference: [xAI function calling](https://docs.x.ai/developers/tools/function-calling), [Responses API](https://docs.x.ai/developers/rest-api-reference/inference/responses).
