# Verification

Review date: **October 4, 2026**. Runtime: **Node 24.19.0**, npm 11.9.0. Results apply to the revised source supplied in this handoff.

## Commands and results

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint -- --max-warnings=0` | Passed, zero warnings |
| `npm test` | **99 tests passed**, zero failures/skips |
| `npm run build` | Optimized production build succeeded |
| `npm run test:e2e` | **5 Chromium tests passed**, zero failures |
| `npm run test:e2e:agents` | **1 Chromium worker-flow test passed**, zero failures |
| `npm run test:e2e:forms` | **5 Chromium form-regression tests passed**, zero failures |
| `npm run test:e2e:forms -- --browser=firefox` | **5 Firefox form-regression tests passed**, zero failures; runner setting below |
| `git diff --check` | Passed |

Dependency versions and the lockfile are unchanged from the reviewed source. The build uses an isolated temporary database and empty provider keys. Browser suites start the production server, payment worker and agent worker with temporary SQLite databases. Their users and agents are created by the browser tests, never seeded into ordinary installations.

For the merchant-catalog update, the 99 domain/API/CLI tests and static/build checks were rerun. The 16 browser passes above are retained evidence from the preceding form-fix review; browser suites were not rerun for this CLI-only feature, which adds no screens or browser actions.

Fresh setup was exercised in a temporary source folder. It created schema version 3 with zero users, auth accounts, workspaces, wallets, registrations, agent profiles, tasks, messages, runs and proposals. It wrote matching canonical URLs, the configured text model, HTTPS Nessie URL and a mode-0600 environment file. A second invocation preserved that file byte-for-byte. Development startup was checked against the temporary database: web health succeeded, both workers recorded current heartbeats, three child processes started, and Ctrl+C caused all three to exit cleanly.

## Agent regression coverage

The new tests cover on-site creation and idempotency, controller/owner and business grant rules, optimistic profile versions, active-allowance read-grant protection, legacy conversion, rejection of external authentication for internal principals, missing-key behavior, per-user chat privacy, original-message context, explicitly selected purchase allowances and actual human intent authors.

Execution coverage includes persisted function-call/output history, strict tool arguments, task/lease/revision binding, unavailable tools, transactional journal replay, rollback after failed tools, research completion, purchase proposals without direct payment authority, outstanding instruction gates, private-chat exclusion from shared task summaries, new-instruction scheduling, review/blocked plan revision, stale-account read refresh, execution budgets and rolling daily limits.

Lifecycle tests check pause/resume epochs, membership removal, shutdown and lost-claim fencing after provider I/O, stale-run failure, reviewed retry, original-message idempotency and no automatic financial replay. Transport tests exercise Responses payloads, `store:false`, serial function calls, safe provider errors and malformed responses. Migration tests upgrade a version-2 database with existing task leases and financial relationships, verify foreign keys, preserve data and repeat safely.

Two storage tests verify that acquiring SQLite write intent before auth reads prevents the competing-worker snapshot race, and that file-backed auth and domain connections cannot accidentally share an unfinished transaction.

## Existing financial, auth and voice coverage

The original 56 regression cases also pass. They include real Better Auth request handling and OAuth exchange, exact money/overflow handling, workspace isolation, last-owner protection, nested rollback, replay conflicts, protected funds, merchant overrides, finance/member privileges, stale grants, revoked connection leases, pause/resume revisions, malformed provider data, one-attempt bank submissions, mismatched or ambiguous receipts, bounded reconciliation, holds and interrupted job recovery.

Voice coverage includes provider-failure cleanup, one active session per user, strict session/task binding, replay identity, rollback, expiry/membership changes, retention deletion, once-only authority confirmation, streaming 44.1 kHz resampling and ordered parallel tool output. Additional agent tests verify voice readiness for an on-site profile without an external connector verification step.

## Browser flows

1. Personal user signup and empty onboarding, creation and editing of an on-site agent, reload persistence, pause/resume, honest missing-key chat/voice controls and full server-rendered page visits.
2. The same agent configuration flow in a business workspace.
3. Signup, empty workspace, logout/sign-in, missing-key banking controls and transcript retention on/off.
4. Signup/onboarding/sign-in on the explicitly configured localhost alias, including a rejected password followed by a successful retry.
5. Legacy business registration, browser OAuth sign-in and consent, PKCE code exchange, MCP initialization and revoked-connection rejection. This retains optional legacy compatibility; the ordinary agent UI uses on-site profiles.
6. A user creates an on-site agent and sends a chat request. The actual agent-worker process calls the Responses transport, executes state/task tools, saves a research task and result, and exposes them after a reload and on the task detail page. Voice readiness is enabled when configured. This test does not open a microphone.

Flow 6 uses an HTTP fixture loaded only by `playwright.agents.config.ts`. It requires an explicit isolated test key and test-database path. Normal dev/start/build commands never load it. It validates the app/worker/tool/database integration without claiming a live Grok model response. The OAuth client in flow 5 is likewise a test harness, not a native bot provisioned for the user.

## Form and merchant regressions

The five additional browser flows check numeric money fields rejecting email values; initially empty, read-only password confirmations becoming editable on focus; consecutive account creation and full successful form resets; preservation of rejected non-secret drafts with cleared passwords; lifetime allowance and protection creation; independent baseline/protection passwords; task creation/reset and rejected purchase drafts; external revocation with the button hidden after success and after reload; and merchant sync counts, authorization errors, empty results and preservation of the existing catalog.

These flows use real app routes, password verification, authorization checks and database writes. Only Nessie's HTTP boundary is replaced by `e2e/banking-provider.ts`, loaded by the explicit form test configuration. It requires a unique test key and an isolated test-database path; ordinary startup never loads it. One real signed-in owner creates a fresh workspace per case, avoiding a burst of signups without disabling production auth limits.

Six additional domain/adapter tests cover plain and paginated merchant lists, bounded pagination, unsafe page destinations, invalid response shapes, retained category confirmations and catalog data after errors or empty results, plus revoked external and on-site internal connection visibility. Existing agent tests also assert that an internal execution principal is not returned as a current external setup connection.

The browser tests use clean profiles. They verify input behavior and form lifecycle, not every password-manager extension or a pre-existing saved-login profile. Browser extensions and manually selected password-manager fills can override autofill hints.

Firefox's initial run timed out while creating the browser page, before any app navigation. A standalone browser check reproduced the container sandbox problem. The final five Firefox tests passed with `MOZ_DISABLE_CONTENT_SANDBOX=1` applied only to that test command in this managed container. This runner setting is not added to app startup or CI configuration and is not an instruction to change the user's Firefox settings.

## Merchant catalog command

Eight new tests exercise the requested 50-business catalog. They cover rename-in-place with preserved ID/location/category, repeated runs without additional writes, read-only previews, punctuation/case matching, duplicate/rename conflicts before mutations, incomplete listing refusal, changed-name protection, creation readback identity, and stopping after an uncertain POST without retrying it.

The CLI integration test starts the actual `scripts/populate-merchants.ts` entry point in an isolated directory using its own `.env.local`. It previews 48 new records plus the Staples rename while keeping an existing Target, applies those changes, then reruns and verifies all 50 names are kept with zero extra writes. The original Staples merchant ID/address remain intact; no Sentinel database is created, the local lock is removed after normal completion, and the test key is absent from command output. Only the Nessie HTTP boundary is replaced with a test fixture.

The live operator command was not run with a real Nessie key in this workspace. It is shipped for the operator to invoke deliberately; default setup and runtime still create no merchant catalog or demo agents.

## Origin and rendering corrections

Loopback aliases are accepted only under the explicit local configuration rules. Unrelated origins and attacker-controlled forwarded hosts remain rejected without a session cookie. Public/proxy origins require deliberate operator configuration. Server-rendered polling does not access an unguarded `document`; agent-detail session loading also avoids the external auth hook's server-rendering dispatcher failure. Signup succeeds while both workers are running.

Incorrect-password and rejected-origin tests intentionally produce auth warnings. Better Auth can report SQLite TEXT/array migration warnings for OAuth fields; the OAuth flow exercises actual serialization. These warnings did not fail the checks above.

## Integration checks still requiring operator access

- Live xAI text-model access, billing, rate limits and actual model/tool behavior were not checked with an operator key.
- Live xAI ephemeral voice credentials, realtime WebSocket events and microphone/speaker output were not checked with a real key/device.
- Live Nessie availability, key permissions and current responses were not checked with a bank sandbox key. Adapter tests use controlled responses.
- Docker/Compose was reviewed but not executed here.
- The remote GitHub repository was not changed and no hosting deployment was created. Host-specific TLS, proxy, volume and service behavior needs deployment checks.

The verified installation starts empty and uses real provider APIs when configured. No demo agents or production fake-provider mode are included.

## Freshness and blocked-purchase recovery update

- On-site task agents refresh a stale observation immediately before executing either purchase-proposal tool, outside the database transaction. Run authority is rechecked after the network read.
- Owners/finance can refresh and recheck the exact existing blocked proposal from Approvals. State, terms, task revision, pending instructions and payment history are checked before and after the bank read. Existing payment operations cannot be retried through this route. All current policy rules still apply; propose-only remains human-reviewed.
- Account refresh and bank reconciliation now show visible request feedback.
- Validation: 109 tests passed, including stale-during-model-turn, concurrent rechecks, failed reads, immutable terms, policy review and existing-payment rejection. Live Nessie behavior was not exercised; existing malformed upstream payments remain unresolved by this update.

## Provider amount compatibility update

112 tests passed, including preservation of decimal JSON request amounts, opt-in whole-dollar quotes and budget caps, fractional-term blocking before bank submission, and mismatched receipt reconciliation that retains reservations and prevents completion. Typecheck, lint and production build were also run. No live account mutation was performed in validation; provider-side truncation and pending settlement remain outside these mocked tests.

## Reconciliation route fallback

116 tests passed. New cases cover direct lookup failure with verified list-based completion applied once, mismatched transaction ID/account/merchant/reference/amount, failed and empty fallback reads, and honest current-pending reporting. TypeScript, lint and production build also passed. Live Nessie requests were not performed from this workspace.

## Explicit sandbox completion and ledger

122 tests passed. New coverage includes separate completed-record readback via the singular route, uncertain readback without a second POST, exactly-once local debit, refresh without budget refill, quarantine without double debit on provider balance changes, preservation of legacy pending operations, and an idempotent version-3-to-4 migration preserving reservations. TypeScript, lint and production build passed. These automated tests do not replace a live acceptance test on the user’s provider/account.
