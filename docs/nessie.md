# Nessie sandbox boundary

The server adapter uses `NESSIE_API_KEY` and `NESSIE_BASE_URL`, defaulting to `https://api.nessieisreal.com`. Existing environment files are preserved during setup; change an old HTTP base URL yourself and restart. Verify the endpoint and available data with your own sandbox key.

Nessie is a sandbox, not a real Capital One customer-login/open-banking integration. Enter sandbox customer/account IDs and sandbox funds only.

## Implemented calls

| Method and path | Use |
| --- | --- |
| `POST /customers` | Sandbox customer creation |
| `POST /customers/:customerId/accounts` | Account creation, followed by verified account readback |
| `GET /accounts/:accountId` | Balance and account/customer identity |
| `GET /customers/:customerId/accounts` | Permitted link candidates |
| `GET /merchants`, `GET /merchants/:merchantId` | Merchant catalog; string or array categories |
| `POST /merchants`, `PUT /merchants/:merchantId` | Explicit operator catalog setup/rename command only; no agent tool |
| `POST /accounts/:accountId/purchases` | One authorized purchase submission |
| `GET /purchases/:purchaseId` | Receipt reconciliation |
| `GET /accounts/:accountId/purchases` | Exact-reference recovery lookup |
| `GET /accounts/:accountId/bills`, `/transfers` | Read adapter methods; no payment/transfer tool |

The API key is sent as Nessie's `key` query parameter, stays server-side, and is excluded from stored error text. Redirects are refused. GETs have bounded retries and per-attempt timeouts; financial POSTs are never automatically retried.

Purchase input includes `merchant_id`, `medium: "balance"`, ISO purchase date, dollar amount and a persisted Sentinel reference in `description`. Status is read from the provider response, rather than fabricated locally. Completed/pending/rejected status variants normalize to explicit internal states; unfamiliar statuses remain unknown.

Malformed lists, IDs or money are errors. Only a provider 404 maps a purchase read to a missing receipt. An authorization failure, throttle, timeout or server error cannot prove a purchase is absent. Uncertain POST responses preserve the reservation.

## Merchant sync

In Settings, **Sync Nessie merchants** creates missing sample businesses, then imports the configured Nessie catalog. **Import existing only** performs a read-only import. Neither action automatically confirms categories. The UI distinguishes a loading catalog, missing server configuration, an upstream failure, a successful import count and a successful request that returned zero merchants. An empty or failed sync keeps previously imported records and confirmed categories.

The merchant parser accepts a plain array or a `{data: [...], paging: {next: ...}}` response. A sync requires a complete scan of at most 1,000 records and ten pages. Pagination must stay on the configured origin and merchant path. The server replaces any key in page metadata with its configured key and refuses redirects and other hosts. Invalid page data or looping pagination fails before catalog writes.

For a sync failure, use the displayed reason to check `NESSIE_API_KEY`, `NESSIE_BASE_URL`, network access and the sandbox's available records. Restart Sentinel after editing the environment file. A successful zero count means the provider returned an empty list; it does not indicate an account-creation failure. These checks need your own key; this handoff does not establish the contents or availability of your live sandbox.

## Populate the sandbox business catalog

Owners can click **Settings → Sync Nessie merchants** without a terminal command. Review the visible suggested categories, then click **Confirm suggested categories** to approve all currently unconfirmed suggestions together, or select individual categories. Existing confirmed choices are preserved, and confirmations apply only to the current workspace.

For an optional operator CLI, run `npm run banking:populate-merchants` from the project root. The command reads `.env.local`/`.env` using Sentinel's normal script loader; process environment values take precedence. It requires a Nessie key and HTTPS API origin, and it does not need an xAI key. Use `-- --dry-run` to preview without writing. `-- --help` works without credentials.

The catalog contains 50 recognizable business names used in the United States, defined in `src/banking/sandbox-merchant-catalog.ts`. The script performs a complete, bounded merchant scan before planning writes (at most 1,000 records and ten pages). An incomplete scan or ambiguous matching names stops setup before mutations. Matching ignores case, whitespace and punctuation; it does not merge unrelated store branches or change existing categories.

If exactly one `Sentinel Office Supplies` record exists and no `Staples` exists, setup changes its name with a PUT while retaining its ID and provider location/category. If neither name exists, it creates Staples. If both names exist, or several records match a requested business, it reports the conflict rather than choosing a record or deleting history. All other existing matching names are retained. New records use suggested spending categories and the explicit placeholder location `1 Sandbox Way, Fairfax, VA 22030` with coordinates `(38.8462, -77.3064)`; these are synthetic test locations, not actual store addresses.

Writes run sequentially, once each, with readback verification. A failure stops subsequent writes; earlier successful changes remain. After a timeout or uncertain response, check the upstream catalog or use **Import existing only** before rerunning. Nessie does not provide a merchant-creation idempotency guarantee; simultaneous setup on different machines or a temporarily invisible upstream write can still produce duplicate names. A shared local lock prevents simultaneous web or CLI setup requests using the same key/server and data directory. An interrupted process may leave this lock; inspect Nessie and confirm the other process has stopped before removing the matching `.merchant-setup-*.lock` file next to the configured database. Do not delete a lock while setup is still running.

Finally sync in Settings. A rename updates the label of the same local merchant, preserving its existing references and workspace category confirmations. Newly imported merchants remain UNKNOWN until an owner confirms their categories. Setup never changes local accounts, allowances or payment records; it runs only after an owner clicks the setup button or an operator invokes the CLI, and is not exposed to Grok tools.

The endpoint shapes follow Nessie's official [merchant SDK implementation](https://github.com/nessieisreal/nessie-javascript-sdk/blob/master/lib/merchant.js) and [merchant creation fixture](https://github.com/nessieisreal/nessie-android-sdk/blob/master/nessie-android-sdk/src/test/resources/mappings/merchant/post-merchant.json). Live creation still requires the operator's sandbox key.

## Receipt and account checks

A purchase can complete only after account, merchant, cents amount and its recorded upstream ID/reference agree. A unique exact reference may identify a recovery candidate; list absence or multiple matches cannot justify a new POST. Pending or ambiguous results stay unresolved and retain their hold.

Amounts cross the boundary through checked cents/dollars helpers. Observations never replace the policy balance merely because a poll returned. Workspace account bindings are checked again after network calls. Upstream accounts can be linked only once in the Sentinel database.

Linking an existing customer first requires `bank_link_permissions` created by the operator CLI:

```bash
npm run banking:grant-link -- WORKSPACE_ID CUSTOMER_ID
```

The Accounts page then lists only permitted customers and their actual upstream account IDs. An ID by itself is not a production ownership check.

Sandbox provisioning performs multiple upstream actions. If it fails after creating a customer/account, inspect Nessie before retrying: the provider may have created a resource that Sentinel could not verify/store. The adapter does not promise provider-side idempotency for those calls.

## Live acceptance check

With your sandbox key, provision/read an account, sync merchants, set a category and a small propose-only mandate, ask your on-site agent to submit a task proposal, approve it, then inspect the worker receipt and balances. Test interruption/reconciliation with sandbox funds. Live endpoints were not contacted during this review; isolated adapter fixtures cover parser/error/retry behavior only.

## Optional whole-dollar compatibility

A user-provided live sandbox receipt returned `amount: 3` for an expected 349-cent purchase, with the correct merchant, account and reference. Sentinel serializes 349 cents as JSON `3.49` (covered by the request-body test). The provider implementation and settlement schedule have not been inspected; no claim is made that all Nessie deployments truncate prices.

For affected demo environments, opt in with `NESSIE_WHOLE_DOLLARS_ONLY=true` in `.env.local` and restart. The catalog displays new sample unit prices rounded up to whole dollars, and the policy engine blocks fractional purchase terms before submission. This changes future displayed catalog prices, not existing proposals, balances or receipts. The eraser becomes $4.00, not a $3.49 purchase silently charged at $4.00. Quantity and user-cap checks use the displayed price. The mode is off by default.

Existing mismatched purchases stay unresolved with their reservations held. In Approvals use Read bank status to record the amount discrepancy if the upstream reference can be found. Do not submit another purchase for the same intent, delete the local operation, or mark the pending record completed. Repair/reconciliation of the existing upstream record requires provider-side investigation. Whole-dollar mode does not guarantee pending transactions will settle and does not bypass receipt verification.

## Direct purchase lookup unavailable

Reconciliation falls back to the account purchase list (by exact Sentinel reference) when `GET /purchases/{id}` fails or returns no purchase. A previously saved transaction ID must still match, as must account, merchant and amount. Ambiguous or absent list results never authorize another submission. A failed current read is labeled explicitly instead of presenting the last saved pending state as a newly verified result. This does not simulate settlement or update the provider transaction status.
