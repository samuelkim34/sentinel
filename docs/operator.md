# Operations

Run one primary web service, one Grok agent worker and one payment worker sharing a local persistent SQLite file. The Settings page shows the worker heartbeat and due-job count. `/api/health` is a web liveness endpoint; check the heartbeat separately to confirm payment processing is running.

## Payment recovery

The worker stores a submission reference before the one upstream POST. Stale pre-submission jobs can be recovered. A recorded financial submission is never sent again automatically. Interrupted `SUBMITTING` operations wait at least 120 seconds before being recovered, beyond the configured provider deadlines.

Reconciliation uses provider reads with backoff and a bounded attempt count. Pending, missing, ambiguous and unrelated receipts keep the hold. After `RECONCILE_MAX_ATTEMPTS`, manual review is required. **Read bank status** in Approvals explicitly queues another read-based reconciliation cycle for owner/finance reviewers. It does not execute another purchase or assume failure from an absent receipt.

A matching completed receipt changes the policy balance once and clears its reservation. Unsubmitted work may be cancelled safely. A submitted purchase cannot be cancelled locally to pretend that upstream money has been restored.

Quarantine indicates an unexplained observed/policy balance difference or a conservative balance problem. Refresh the account, inspect receipts and unresolved operations, then an owner may confirm a fresh baseline with their password. Baseline changes are refused with unresolved payments.

Pause cancels eligible unsubmitted work, drops its hold and lease, and leaves recorded submissions to reconcile. Resuming paused purchase work uses a new revision; old cancelled proposal terms remain immutable. Mandate revocation/expiry cancels eligible unsubmitted tasks. Removed members' connections are revoked.

## People and authority

Business invitation links are hashed, valid once, and expire after seven days. The recipient must sign in to accept. Acceptance also checks the inviting owner's current authority. The app generates links but sends no email. Owner/finance invitations and authority promotions require fresh password confirmation. The last active owner cannot be removed/demoted.

Registering a business Bot cannot be used to grant account visibility to oneself: read grants require owner authority. Merchant category confirmations are workspace-specific. The upstream catalog's raw categories are not spending permission.

## Backup and restore

Stop all three processes cleanly, then copy the entire database directory and private environment file to a protected backup. Include any `-wal` and `-shm` companions still present. Alternatively use SQLite's backup API or `VACUUM INTO` for a coherent database snapshot. Do not copy only the main file while a live WAL contains newer commits.

Keep `BETTER_AUTH_SECRET` with the restored configuration. Start with the same database path and run migrations before serving. The ZIP and GitHub repository contain neither the review database nor credentials. Protect runtime files with filesystem permissions and use the host's persistent volume/backups.

## Startup messages

Better Auth 1.7.7's SQLite migration checker may warn that OAuth array fields expect `string[]` but are stored as `TEXT`. This provider/SQLite combination serializes arrays in text columns. The tested registration, resource creation, authorization, consent, PKCE and token flows succeed with that representation; do not manually rewrite those tables based only on this warning.

A different startup error, missing table, invalid canonical URL, or rejected migration still needs investigation. See the deployment troubleshooting table and verification limits.

## Agent execution recovery

The agent panel reports agent-worker liveness separately from the payment heartbeat. Both workers launch with normal dev/start. Operate one instance of each, sharing the same persistent SQLite file.

A model request times out after its configured deadline. Runs have bounded steps and tool calls; tool failures are recorded. A worker claims with a token and deadline, refreshed while waiting for Grok. Stale claims become failed without automatically replaying actions. Review a failed run’s tools before explicit retry. The run button refuses financial tasks that already have pending/submitted commitments or have ended.

Task instruction events and resume epochs prevent polling loops. A task waiting for human input stays unfinished; a new instruction schedules new work. Waiting-for-review or blocked tasks can accept new instructions before irreversible submission. Revised proposals require current policy and eligible approval. Expired leases for on-site agents are removed without presenting unfinished model work as automatically rerunning.

Server keys are shared operator credentials; users do not need individual Grok accounts. Model/API access failures require operator configuration. Workspace limits are not a provider-dollar cap. Keep database and backups private: text chat and tool results are stored in SQLite and are visible to an operator with filesystem access.
