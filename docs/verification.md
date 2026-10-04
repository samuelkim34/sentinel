# Verification

Review date: **October 3, 2026**. Runtime: **Node 24.19.0**, npm 11.9.0. Checks are against this corrected source, not the original Cursor verification claims.

## Commands and results

| Command | Result |
| --- | --- |
| `npm ci` | Dependency installation succeeded using the committed lockfile |
| `npm run typecheck` | Passed |
| `npm run lint -- --max-warnings=0` | Passed |
| `npm test` | **56 tests passed**, zero failures/skips |
| `npm run build` | Optimized production build succeeded; App Router routes generated |
| `npm run test:e2e` | **3 Chromium tests passed**, zero failures |

The build runs migrations on a temporary isolated database. Browser tests start the production server with a separate temporary SQLite database and fixture secret. Provider keys are explicitly empty. Tests do not seed the user's installation.

Fresh `setup` was also exercised in a temporary source folder: it created all tables with zero users/accounts/Bots/tasks/proposals, used matching canonical URLs, and preserved configuration on a second invocation. `dev` was exercised with a separate temporary database: web health and worker heartbeat succeeded, and both child processes stopped cleanly.

## Regression coverage

Automated tests include real Better Auth request handling and OAuth code exchange, money precision/overflow, empty installation, workspace isolation, last owner, nested transaction rollback, request replay conflicts, protection floor calculations, workspace merchant overrides, finance privilege restrictions, member cancellation/account visibility, expired/stale grants, revoked connection leases, pause/resume revisions, malformed merchants and money, uncertain one-attempt provider POSTs, mismatched receipts, bounded pending reconciliation, missing/ambiguous receipt holds, and interrupted job recovery.

Voice coverage includes provider failure cleanup, one concurrent active session, strict session/task binding, replay versus new call IDs, transactional rollback, expiry/membership changes, retention deletion, once-only authority draft confirmation, streaming 44.1 kHz resampling and parallel tool output sequencing.

## Browser flows

1. Signup → empty personal workspace → empty Bot list → logout → signin → missing-key banking controls → transcript retention on/off.
2. Signup/onboarding/signin on the explicitly configured localhost production alias, including a failed password then successful retry.
3. Business workspace → user-created registration → OAuth resource creation → anonymous native client registration → signed-in browser logout → OAuth login → correct consent preview → approval → PKCE code exchange → authenticated MCP initialization → revocation rejected by MCP.

The native client in flow 3 is a test harness, not an actual Grok Bot. Its registration and task data live only in the browser test database.

## Origin reproduction

Before correction, `http://localhost:43117` could be rejected when the app was configured for `http://127.0.0.1:43117`. Worse, an unrelated origin combined with an attacker-controlled forwarded host was implicitly trusted and could obtain a session. The corrected tests prove the loopback alias succeeds while `https://evil.example` stays rejected and receives no session cookie. Arbitrary proxy origins now require explicit operator configuration.

The rejected-origin test intentionally produces an auth error log. An incorrect-password browser case intentionally logs a password warning. Better Auth may also report SQLite TEXT/array migration warnings for OAuth fields; the exercised OAuth flows verify actual serialization behavior. These messages are distinguished from failed assertions/builds.

## Remaining validation

- Live Nessie API availability, key permissions and current response contracts were not verified. Adapter tests use controlled responses.
- Live xAI ephemeral credentials, realtime WebSocket events and microphone/speaker output were not verified with an actual key/device.
- The user's installed native Grok Bot/MCP client was not connected.
- Docker/Compose execution was unavailable; configuration was reviewed only.
- No remote GitHub repository or hosting deployment was created. Host-specific TLS/proxy/volume/service behavior needs deployment checks.

These results establish the covered local behavior; they do not promise every edge case or integration environment works without its own acceptance check.
