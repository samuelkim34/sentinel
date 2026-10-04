# Sentinel

Sentinel gives individuals and businesses a shared control panel for work delegated to their own Grok Bots. People set account protections and spending mandates, assign tasks, review proposals, and ask an embedded Grok voice controller about the same stored work. A separate worker submits eligible purchases to Capital One's Nessie **sandbox**.

A fresh installation starts empty. Native Grok Bots are created by the user in Grok; Sentinel records their registrations and exposes scoped MCP connections. There are no installed demo agents or sample accounts. Test fixtures exist only under `test/` and `e2e/`.

## Start locally

Install **Node.js 24.15 or newer within the 24 release line**. From this folder:

```bash
npm ci
npm run setup
npm run dev
```

Open **http://127.0.0.1:43117**. Create your account, then a personal or business workspace. `setup` generates a private `.env.local` and the SQLite tables. `dev` starts both the web app and the payment worker. Stop them with Ctrl+C.

Add these server-side values to `.env.local`, then restart:

```dotenv
NESSIE_API_KEY=your-nessie-sandbox-key
XAI_API_KEY=your-xai-key
```

Without keys you can sign up, sign in, create workspaces, and register your own Bots. Banking and voice show their configuration requirements. API keys are never entered in browser code.

## Fixing the origin error

The browser address, port, and configured origin must agree. Use this pair locally:

```dotenv
APP_ORIGIN=http://127.0.0.1:43117
BETTER_AUTH_URL=http://127.0.0.1:43117
PORT=43117
```

`setup` preserves an existing `.env.local`, so correct old values yourself. Restart the server after editing. Development also accepts the matching localhost/IPv6 loopback aliases. For another address, add its **exact origin, including scheme and port**, to `ALLOWED_ORIGINS`. Production aliases need explicit configuration. A forwarded Host header does not grant trust.

Cookies belong to the browser hostname where you signed in. Use one consistent address when signing in and setting up a connector. This ZIP contains source only; it does not contain your previous database or private environment file. See [deployment and upgrading](docs/deployment.md) to retain an existing account.

## First real setup

1. Create a workspace. Business owners can invite members and finance reviewers from Settings using copyable links.
2. Configure Nessie, then use Accounts to provision a sandbox customer/account, confirming your password. To link an existing sandbox account, the operator first grants its customer ID using `npm run banking:grant-link -- WORKSPACE_ID CUSTOMER_ID`.
3. Sync merchants in Settings and confirm usable categories. Accounts can have protected amounts.
4. Register a Bot in Sentinel and create the native Bot in Grok. Connect its exact MCP URL using the steps in [Grok Bot setup](docs/grok-bot-setup.md).
5. Have the native Bot call `get_context` to verify its tools. Create a research task first. A purchase task also needs a current owner-granted mandate.
6. Review purchase proposals in Approvals. The default mandate mode is propose-only. Business approvals must come from an eligible person who did not author or control the request.
7. With xAI configured and the tool connection verified, use Talk on the Bot or task page. Voice reads shared Sentinel state and queues explicit instructions. Authority changes remain drafts until an owner confirms the exact terms and password.

The implemented financial action is a Nessie merchant purchase in USD. Production Capital One account login, real-money banking, transfers, bill payment, investing, lending, and autonomous external shopping are outside the current implementation.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | Generate missing local configuration and migrate |
| `npm run dev` | Development web app and worker |
| `npm run migrate` | Apply authentication and application migrations |
| `npm run build` | Production build using an isolated temporary database, without provider keys |
| `npm run start` | Production web app; run the worker separately |
| `npm run worker` | Payment/reconciliation worker |
| `npm run typecheck` | TypeScript check |
| `npm run lint -- --max-warnings=0` | ESLint check |
| `npm test` | Isolated automated tests, without live providers |
| `npm run test:e2e` | Chromium flows against the production build |
| `npm run banking:grant-link -- WORKSPACE_ID CUSTOMER_ID` | Operator permission for an existing sandbox customer |

For browser tests run `npm run build`, then `npx playwright install chromium`, then `npm run test:e2e`. Linux CI installs Chromium system dependencies too.

## GitHub and hosting

Push this source to GitHub using [the deployment guide](docs/deployment.md). The included GitHub Actions workflow checks types, lint, automated tests, build, and browser flows. `.gitignore` excludes local secrets and databases.

**GitHub Pages serves static files. This application needs a running Node server, persistent SQLite storage, and a worker.** Use GitHub for the repository/CI and a server or container host for the running application. The supplied Docker/Compose configuration describes one web service and one worker sharing a database volume; Docker execution was not available during this review.

## Verification and code map

The reviewed source passed 56 automated tests, TypeScript, ESLint, production build, and Chromium signup/sign-in/OAuth flows on Node 24.19.0. Live Nessie, xAI audio, and an actual native Grok Bot were not exercised because provider credentials were not supplied.

- [Review and fixes](docs/review.md)
- [Verification evidence and limits](docs/verification.md)
- [Architecture and source map](docs/architecture.md)
- [HTTP/MCP API](docs/api.md)
- [Grok Bot setup](docs/grok-bot-setup.md)
- [Nessie contract](docs/nessie.md)
- [Voice implementation](docs/voice.md)
- [Operations and backup](docs/operator.md)
- [Integration status](docs/integrations.md)
- [GitHub, deployment, and upgrade](docs/deployment.md)
