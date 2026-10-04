# GitHub, deployment, and upgrades

## Upload the source to GitHub

Create an empty GitHub repository, without an initial README, then run these commands in the extracted project folder:

```bash
git init
git branch -M main
git add .
git status --short
git commit -m "Add Sentinel app and regression checks"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

Replace the repository URL with yours. Inspect `git status` before committing: `.env.local`, `data/`, `node_modules/`, `.next/`, and browser traces should be absent. The workflow in `.github/workflows/ci.yml` runs on pushes and pull requests. This handoff has not created a repository or deployed a website on your behalf.

`SOURCE_REPOSITORY_URL=https://github.com/YOUR_USERNAME/YOUR_REPOSITORY` optionally enables the app's source-download link. It redirects to GitHub's default-branch ZIP. Private repositories still require GitHub permission. The app never archives its runtime directory or database through a public endpoint.

## Where the app runs

GitHub Pages is static hosting and cannot run these Next.js API routes, Better Auth, SQLite, MCP endpoints, or the continuously running worker. Keep the application on a Node/container host with a persistent local disk. GitHub can store and check the source.

The supported deployment shape is **one primary web service, one Grok agent worker and one payment worker sharing one SQLite file on the same host**. A normal function deployment or multiple independent ephemeral disks will not preserve shared state. Avoid replicas or multiple payment workers for this deployment. SQLite WAL belongs on a local filesystem shared by the three processes.

## Production configuration

Provide `.env.local` or the host's server environment. Generate a strong auth secret once and retain it across restarts/upgrades. Set:

```dotenv
APP_ORIGIN=https://YOUR_PUBLIC_HOST
BETTER_AUTH_URL=https://YOUR_PUBLIC_HOST
BETTER_AUTH_SECRET=your-existing-or-generated-secret-at-least-32-characters
SENTINEL_DB_PATH=/absolute/persistent/path/sentinel.sqlite
PORT=43117
ALLOWED_ORIGINS=
ENABLE_MCP_DCR=false
NESSIE_API_KEY=your-nessie-sandbox-key
XAI_API_KEY=your-xai-key
```

Canonical URLs are origins only: no `/api/auth`, path, credentials, query, or fragment. The app adds its auth path. Use HTTPS for public production URLs. Add an extra browser origin to `ALLOWED_ORIGINS` only when you deliberately support it. `ALLOWED_DEV_ORIGINS` contains additional development hostnames and does not replace the auth allowlist.

Enable `ENABLE_MCP_DCR=true` if the chosen native MCP client needs dynamic OAuth client registration. It opens anonymous client registration; authorization still requires sign-in, consent, PKCE, the exact resource audience, the matching controller user, and a live connection. Leave it false until needed. Native loopback OAuth callbacks register `application_type: "native"`.

Run:

```bash
npm ci
npm run build
npm run start
```

`npm start` starts web, agent worker and payment worker together. For separate supervision use `npm run start:web`, `npm run worker:agents` and `npm run worker` with the same environment and database path. Do not start duplicate workers on top of the bundled startup.

`start` applies migrations before serving. The build uses its own temporary database and generated secret so CI can build without access to deployment secrets or user data. Use a service manager with automatic restart and a graceful shutdown period. The reverse proxy must preserve HTTPS browser origins, forward cookies, and allow MCP POST/streaming responses without buffering them indefinitely.

## Docker Compose

The included image uses Node 24 and builds without provider credentials. With runtime `.env.local` configured:

```bash
docker compose up --build -d
docker compose logs -f web worker agent-worker
```

All three containers use the named `sentinel-data` volume at `/data/sentinel.sqlite`. Both workers start after the web health check succeeds. A public HTTPS reverse proxy still needs to be configured by the host/operator. Keep the volume when replacing containers. Do not use `docker compose down -v` when retaining data.

The Compose volume starts empty. To bring an existing database into it, stop all three containers and transfer the backed-up database and any WAL companions into that volume before restarting. Docker/Compose was reviewed but could not be run in the review environment.

## Upgrade from the original Cursor project

1. Stop the original web app and both workers.
2. Back up the entire `data/` directory and the private environment file. Keep any `-wal` and `-shm` companions with the database.
3. Extract this corrected source into a fresh folder, then copy your original `.env.local` and database directory into it. Preserve `BETTER_AUTH_SECRET` and the configured database path.
4. Correct `APP_ORIGIN`, `BETTER_AUTH_URL`, and `PORT` for the address you will use.
5. Run `npm ci`, then `npm run setup`. Setup preserves an existing environment file and migrates the database; it does not seed agents or erase users.
6. Run `npm run dev`, or build/start for production; startup now launches both workers automatically.

Application migration `003_onsite_agents` preserves existing connection/lease relationships and adds persistent on-site agent profiles, chat messages and execution journals. Convert legacy registrations from their agent page after finishing external work. The operator sets one `XAI_API_KEY`; end users configure agents on-site. No public MCP tunnel is needed for local agent execution.

Application migration `002_review_fixes` makes previous owner merchant-category overrides remain workspace-specific. Existing workspaces, accounts, tasks, and users are retained. The migrations have no downgrade path; use the backup when rolling back application versions.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `INVALID_ORIGIN` | Compare the browser's scheme/host/port with both canonical URLs and `ALLOWED_ORIGINS`, then restart. Use one browser hostname consistently. |
| Browser resources blocked in development | Add the deliberate dev hostname through the canonical URL or `ALLOWED_DEV_ORIGINS`; also configure the auth origin separately. |
| Existing account is missing after extracting ZIP | Restore the original database and secret; the download contains source, not your database. |
| No banking/agent key configured | Add the corresponding server key and restart. |
| OAuth registration refused | Enable DCR if your client requires it; use native application type for HTTP loopback callbacks. |
| `OAUTH_RESOURCE_SETUP` | Verify migrations and auth origin/configuration. The failed connection is revoked; create a new connection after fixing configuration. |
| Chat or tasks stay queued | Ensure the Grok agent worker is online; `npm run dev` and `npm start` launch it automatically. |
| Payments stay queued | Ensure the payment worker is online and inspect the Settings heartbeat. |
| Wallet quarantined | Refresh and inspect its observed balance. Resolve in-flight payments before owner baseline confirmation. |
| Reconciliation/manual review | Use read-status reconciliation; inspect the upstream receipt before making any new purchase. |

See [verification](verification.md) for what was actually exercised.

Application migration `005_remove_voice` deletes the retired session, transcript, tool-journal, preference and authority-draft tables. Historical task instructions are retained with a `LEGACY` source label. Accounts, text conversations, tasks, allowances and payment records are preserved. Back up the database before upgrading; do not run an older application against schema version 5.
