# Code review and corrections

Reviewed October 3, 2026, against the supplied Cursor project ZIP. The corrected handoff preserves the native user-created Grok Bot architecture and empty installation. Runtime secrets, dependencies, generated builds, browser traces and review databases are excluded.

## Authentication and configuration

The reported sign-in issue reproduced as `INVALID_ORIGIN` when canonical and browser loopback hostnames differed. The previous origin helper also trusted attacker-controlled forwarded hosts, allowing an unrelated origin to obtain a session. The replacement uses exact validated configured origins, limited development loopback aliases, and explicit production aliases. Canonical app/auth origins must agree. Sign-in reports a useful correction path and restores pending state after network failure.

OAuth resource creation originally lacked the current human session and could fail silently. It now passes both session and internal privilege, activates only after resource setup succeeds, and revokes failed connections. The installed provider's per-client resource restriction is explicitly configured for resources created before native clients register. Token audience/issuer/controller and live connection authorization remain enforced. The browser OAuth client preserves signed authorization queries across login and follows the provider redirect into consent. Discovery paths and MCP authentication challenges are supplied.

## Payments and permissions

- Nested transactions use savepoints, so an inner financial/voice mutation rolls back with its outer journal.
- Protected-fund shortfalls count each floor once; enabling a floor cannot undercut committed holds.
- Merchant-category overrides are isolated per workspace.
- Finance cannot grant itself business account reads or use business personal-token credentials. Authority promotions and sensitive forms use password confirmation.
- Member cancellation, account payment records, activity, and voice task access are constrained to permitted work.
- Revoked connections invalidate bound leases and prevent still-unsubmitted payment jobs.
- Paused work can resume with a fresh revision without reusing cancelled immutable proposals.
- Wallet observations recheck account/customer identity and version after network calls; baselines require fresh observations and no unresolved operations.
- Receipt completion requires matching identity and exact money. Unrelated or ambiguous receipts keep the hold.
- Pending reconciliation is bounded and backs off. Missing receipts cannot trigger another provider POST.
- Interrupted jobs distinguish pre-submission work from recorded financial submissions and observe a recovery grace period.

## Voice

Provider startup failures now close the reserved session and permit retry. Concurrent starts are guarded by a database index and browser lifecycle state. Calls validate strict shared schemas, membership, session/target/token binding and expiry. Their mutation plus replay result commits atomically.

Voice supports shared-state reads, instructions, controlled tasks, pause and authority drafts. It exposes no bank/approval/escalation tool. Draft confirmation uses owner/password/exact-term checks. Transcript opt-out deletes stored text and applies to active sessions. Logout ends server sessions and revokes password-confirmation grants.

The UI now stops actual microphone transmission when muted, clears input frames, cleans up failed/disconnected/expired sessions, maintains resampling position across chunks, discards superseded playback and sends one continuation after all parallel tool outputs.

## Running and hosting

Runtime scripts work on the required Node 24 line without tsx CLI IPC assumptions. Environment parsing uses Node's parser. Setup preserves existing private configuration, dev starts/stops both services, production startup migrates, and builds use an isolated temporary database. Build no longer needs remote font downloads or a global runtime monkeypatch.

The account creation UI supplies the required password grant and disables unavailable provider actions. Existing-account candidate UI uses the actual server DTO. Additional state-changing forms display failures and honor pending/role requirements.

The broken runtime `git archive HEAD` download was replaced with an explicitly configured GitHub source link. The image/Compose files and Actions checks are included. GitHub Pages is documented as static hosting and cannot run this backend/worker/database architecture.

## Evidence and remaining limits

See [verification](verification.md): 56 automated tests, TypeScript, lint, production build and Chromium account/OAuth flows pass. The tests use isolated fixtures only. No live Nessie or xAI key was supplied, no native Grok app was connected, and Docker was unavailable. Those integrations need the acceptance checks documented in their respective guides. Passing local checks is not a claim that an unconfigured external service is live or that every possible deployment/financial scenario has been proven.
