# Nessie sandbox boundary

The server adapter uses `NESSIE_API_KEY` and `NESSIE_BASE_URL`, defaulting to `http://api.nessieisreal.com`. The default matches the historical Nessie sandbox interface; its current availability and response contracts must be verified with your own sandbox key. HTTPS alternate endpoints can be configured if supported by the provider.

Nessie is a sandbox, not a real Capital One customer-login/open-banking integration. Enter sandbox customer/account IDs and sandbox funds only.

## Implemented calls

| Method and path | Use |
| --- | --- |
| `POST /customers` | Sandbox customer creation |
| `POST /customers/:customerId/accounts` | Account creation, followed by verified account readback |
| `GET /accounts/:accountId` | Balance and account/customer identity |
| `GET /customers/:customerId/accounts` | Permitted link candidates |
| `GET /merchants`, `GET /merchants/:merchantId` | Merchant catalog; string or array categories |
| `POST /accounts/:accountId/purchases` | One authorized purchase submission |
| `GET /purchases/:purchaseId` | Receipt reconciliation |
| `GET /accounts/:accountId/purchases` | Exact-reference recovery lookup |
| `GET /accounts/:accountId/bills`, `/transfers` | Read adapter methods; no payment/transfer tool |

The API key is sent as Nessie's `key` query parameter, stays server-side, and is excluded from stored error text. Redirects are refused. GETs have bounded retries and per-attempt timeouts; financial POSTs are never automatically retried.

Purchase input includes `merchant_id`, `medium: "balance"`, ISO purchase date, dollar amount and a persisted Sentinel reference in `description`. Status is read from the provider response, rather than fabricated locally. Completed/pending/rejected status variants normalize to explicit internal states; unfamiliar statuses remain unknown.

Malformed lists, IDs or money are errors. Only a provider 404 maps a purchase read to a missing receipt. An authorization failure, throttle, timeout or server error cannot prove a purchase is absent. Uncertain POST responses preserve the reservation.

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

With your sandbox key, provision/read an account, sync merchants, set a category and a small propose-only mandate, have your native Bot submit a task proposal, approve it, then inspect the worker receipt and balances. Test interruption/reconciliation with sandbox funds. Live endpoints were not contacted during this review; isolated adapter fixtures cover parser/error/retry behavior only.
