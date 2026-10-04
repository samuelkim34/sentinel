# Completed sandbox purchases and local spending

Enable both flags in the existing `.env.local`, then restart the web and payment/agent workers:

```
NESSIE_SIMULATE_COMPLETION=true
NESSIE_WHOLE_DOLLARS_ONLY=true
```

This is an explicit simulation, not real payment settlement. For new submissions Sentinel sends `status: completed` to Nessie, separately reads the purchase back using the current singular `/purchase/{id}` route (with account-list fallback), validates the receipt, and debits the Sentinel spending balance once. Nessie may retain its original reported balance; the UI shows that separately. Catalog prices are whole-dollar sample totals in compatibility mode.

## Clean first test

Use a new sandbox account with $100. Give your agent read access and an OFFICE allowance tied to that account. Confirm Staples as OFFICE. Create one new Purchase task with the matching allowance: `Make a new sandbox test purchase of one Staples eraser for the catalog total of $4.` The expected result is SANDBOX COMPLETED, Sentinel spending balance $96, no remaining $4 reservation, and possibly Nessie reported balance $100. Refreshing the account must not refill the $4.

Do not use an account with old unresolved payment operations for this clean test. Existing pending and mismatched purchases are preserved and are not recreated, rewritten, auto-completed or silently removed. This update does not repair those provider records. One unresolved operation continues to block further submissions from its account.

## Accounting

At the first simulated submission, the account is enrolled in a persistent local sandbox ledger with its initial local budget and observed provider balance. Completed receipts debit `wallets.policy_balance_cents` exactly once using the existing `receipt_applied` guard and operation/proposal records. Pending or unverified receipts keep their reservation. The account summary always distinguishes local funds from provider-reported funds.

A refresh of the unchanged provider balance updates freshness without changing local funds. A change in the provider balance quarantines the account for review; Sentinel neither subtracts the same purchase again nor assumes an unrelated balance change is settlement. The ordinary baseline-reset action is disabled for enrolled accounts, including after a restart, to prevent restoring spent money. Turning simulation off does not remove the ledger or permit mixed-mode new payments from that account.

No provider balance-update, withdrawal, status-update or deletion is issued by this feature. It uses one purchase creation and readbacks. The $1 experiments previously run outside Sentinel do not become local agent purchases.

The database migration is version 4 and preserves all existing records. Keep the pre-update backup; older application versions must not run against this migrated database.

## Limits and validation

The live user experiment established that creation accepts `completed` while the provider balance remained unchanged. Automated tests mock that behavior; no live purchase was performed from this workspace. A timeout or failed readback remains uncertain and is reconciled instead of retried. Existing allowance, category, protected-fund, approval and reservation checks remain in force.
