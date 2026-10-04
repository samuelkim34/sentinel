# Sentinel

Sentinel lets individuals and businesses delegate financial work to Grok-powered agents they create, configure and talk to **inside Sentinel**. Humans control account access, protected funds, lifetime allowances and approvals. Agents can explain recorded finances, research those records, queue requested tasks and propose authorized sandbox purchases. A separate payment worker validates and settles eligible purchases through Capital One’s Nessie sandbox.

A fresh installation starts empty. There are no installed demo agents or sample accounts. The runtime uses the xAI API; it does not provision native bots in the Grok app. Users need a Sentinel account, not a separate Grok bot setup. Test provider fixtures exist only under `test/` and `e2e/` and are never loaded by ordinary startup.

## Run locally

Use **Node 24.15 or newer in the 24 release line**. Node 26 is not supported by this project's declared engine. From the extracted `sentinel-main` folder:

```bash
npm ci
npm run setup
npm run dev
```

Open **http://127.0.0.1:43117**. Setup generates a private `.env.local` and applies migrations. Dev starts the web app, Grok agent worker and payment worker together. Ctrl+C stops them.

The **site operator** adds these values to `.env.local` once and restarts:

```dotenv
XAI_API_KEY=your-xai-api-key
XAI_AGENT_MODEL=grok-4.7
NESSIE_API_KEY=your-nessie-sandbox-key
NESSIE_BASE_URL=https://api.nessieisreal.com
```

Keep keys on the server. Users never enter them into agent forms. The text model is configurable for the operator's available xAI model access. The Grok voice model has its own `XAI_VOICE_MODEL` setting. Without keys, sign-up, sign-in, workspaces and agent configuration work; chat/execution/voice and banking report the missing configuration.

## Use the app

1. Sign up and create a personal or business workspace. Owners can copy invitation links from Settings for business members and finance reviewers.
2. Go to **Bots → Create an agent**. Choose a name, purpose, instructions and account read access. Business read grants require an owner. No external Grok account, MCP connection or public tunnel is needed for this flow.
3. Open the agent to edit configuration, **chat**, view recorded tool calls and runs, or **Talk** using realtime Grok voice. Microphone access needs loopback or HTTPS. No external tool-verification step is required for an on-site agent.
4. Use Accounts to provision a Nessie sandbox customer/account after confirming your password. Existing customer linking requires an operator permission: `npm run banking:grant-link -- WORKSPACE_ID CUSTOMER_ID`.
5. Sync merchants in Settings and confirm categories. Protect required account funds, and grant an agent a bounded lifetime allowance if it should propose purchases. Propose-only is the default.
6. Create research or purchase work in Tasks, or ask your agent in chat. **Research and conversation only** is the default chat permission. Selecting an allowance explicitly permits a purchase task from that message; auto-within-limits may submit eligible sandbox purchases without another approval.
7. Inspect task updates and proposals. Requests needing review go to Approvals. Business self-approval checks still apply. A reserved or submitted proposal is not a completed purchase: completion requires a matching persisted bank receipt.
8. Queue additional task instructions from the task page, chat or voice. Pausing prevents later agent writes and cancels eligible unsubmitted financial work. Submitted payments continue reconciliation.

Research uses persisted records and user-provided facts; this implementation has no live web-research or retailer-checkout tool. Nessie does not expose product prices. Supply known merchant/amount terms for purchase tasks. The supported financial operation is one USD **sandbox merchant purchase**, not production Capital One customer login, real-money banking or autonomous shopping.

## Upgrade your existing project

Stop Sentinel, then back up `.env.local` and the entire `data/` directory, including any remaining SQLite WAL/SHM files. Extract the updated source into a new folder and copy your existing environment file and data into it. Preserve `BETTER_AUTH_SECRET` and `SENTINEL_DB_PATH`; this download contains neither your old accounts nor secrets. Run `npm ci`, `npm run setup`, then `npm run dev`.

Migration `003_onsite_agents` adds persistent agent profiles, conversations, runs and tool journals while preserving existing registrations, permissions, tasks, leases and payment relationships. Open an old registration and choose **Enable on-site agent**. This revokes its external connections and retains its grants/tasks; finish or cancel live external work before conversion. New agents use on-site execution immediately.

## Origin and server rendering fixes

Use matching canonical URLs and the browser address:

```dotenv
APP_ORIGIN=http://127.0.0.1:43117
BETTER_AUTH_URL=http://127.0.0.1:43117
PORT=43117
```

Setup preserves an existing environment file, so correct old values yourself and restart. Extra deliberate origins go in `ALLOWED_ORIGINS`, including scheme and port. A request's Host header does not grant trust. Polling callbacks are safe during server rendering; the `document is not defined` regression is fixed. Auth uses a separate file-backed SQLite connection and acquires write intent before transactional reads, preventing the signup snapshot race found with running workers.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | Generate missing configuration and migrate without seeding |
| `npm run dev` | Development web app plus both workers |
| `npm run build` | Production build with isolated data and no provider keys |
| `npm start` | Production web app plus both workers; applies migrations first |
| `npm run start:web` | Web only when workers are supervised separately |
| `npm run worker:agents` | Grok agent worker |
| `npm run worker` | Payment/reconciliation worker |
| `npm run typecheck` | TypeScript check |
| `npm run lint -- --max-warnings=0` | ESLint check |
| `npm test` | Isolated domain/provider regression tests |
| `npm run test:e2e` | Browser setup, origin, rendering and optional OAuth tests |
| `npm run test:e2e:agents` | Real server/worker browser flow using an isolated provider fixture |
| `npm run test:e2e:forms` | Account/task/allowance clearing, confirmations, revocation and merchant-sync regression flows |
| `npm run test:e2e:forms -- --browser=firefox` | The same form flows in Firefox |

Build before browser tests; install browsers with `npx playwright install chromium firefox` when needed. CI also installs their Linux system dependencies. The browser provider fixtures require isolated test keys and are used only by their explicit test configurations.

Money fields use decimal numeric inputs and cannot accept login email addresses. Password confirmations start empty and read-only until focused, with autofill disabled. They are cleared after an attempted action; independent approval/baseline forms do not share password values. Account, task, protection and allowance creation reset after success and retain non-secret inputs on failure. Browser extensions can choose to override autofill hints; manually selected password-manager fills remain browser-controlled.

Merchant sync displays progress, imported/updated counts, upstream errors and empty provider results separately. It supports raw arrays and bounded same-origin paginated lists, preserves confirmed categories and never creates replacement merchants when the bank returns no data.

## Add recognizable sandbox businesses

After setting your Nessie key, run this from the project folder:

```bash
npm run banking:populate-merchants
```

This explicitly requested setup command renames `Sentinel Office Supplies` to **Staples**, preserving its upstream ID, address and purchase references, then adds any missing names from a 50-business U.S. catalog. Examples include Walmart, Target, Costco, Amazon, Starbucks, McDonald's, CVS Pharmacy, Uber, Microsoft, Netflix, Marriott and Delta Air Lines. An existing match is kept; rerunning a completed command adds no duplicate names. Ambiguous existing names are reported before any writes. An optional preview is `npm run banking:populate-merchants -- --dry-run`.

These are sandbox representations of real business names. New records use a shared synthetic Fairfax address and coordinates, not verified store branches. They do not establish retailer connections or create real orders. Ordinary setup/startup stays empty; no merchants are added until you run this command.

Afterward, open **Settings → Sync Nessie merchants** and confirm the categories for the merchants your agents will use. Provider category suggestions do not grant spending authority. See [the catalog and recovery details](docs/nessie.md#populate-the-sandbox-business-catalog).

## GitHub and hosting

Copy the revised source into your existing Git checkout, keeping its `.git` directory and local data/configuration. Review changes, commit and push to your repository. Secrets, databases, dependencies and builds are ignored. This handoff does not push changes remotely.

GitHub Pages cannot run this application's server APIs, authentication, database or workers. GitHub can hold the code and run CI. Local execution is enough for a hackathon presentation. A public deployment needs a Node/container host with persistent local SQLite storage. Compose includes web, agent-worker and payment-worker services sharing one volume; see [deployment](docs/deployment.md).

## Implementation guides

- [On-site Grok setup](docs/grok-bot-setup.md)
- [Architecture, source map and execution controls](docs/architecture.md)
- [API contracts](docs/api.md)
- [Voice](docs/voice.md)
- [Nessie integration](docs/nessie.md)
- [Operations and backup](docs/operator.md)
- [Verification evidence and limits](docs/verification.md)
- [Integration status](docs/integrations.md)

## Fixed-price sandbox products

Settings now includes a searchable catalog of 100 fictional fixed-price items linked to the 50 sandbox merchants. On-site Grok agents can search and propose these items without asking you to supply prices. See [the catalog and usage guide](docs/sandbox-products.md). Existing allowances and merchant category checks still apply.

## Explicit sandbox completion

For providers that store transactions without updating balances, enable `NESSIE_SIMULATE_COMPLETION=true` to record and verify completed sandbox purchases while maintaining a distinct local spending ledger. Read [setup, accounting and old-payment limitations](docs/sandbox-completion.md) before enabling. This is not real bank settlement.
