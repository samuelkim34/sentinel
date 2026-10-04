import assert from "node:assert/strict";
import { it } from "node:test";
import { NessieClient } from "../src/banking/nessie-client";
import { BankOperationError } from "../src/banking/types";

const kind = (expected: string) => (error: unknown) => error instanceof BankOperationError && error.kind === expected;
function client(body: unknown, status = 200) { return new NessieClient({ baseUrl: "https://fixture.invalid", apiKey: "fixture-key", fetchImpl: async () => Response.json(body, { status }) }); }

it("normalizes string and array merchant categories on the public merchants route", async () => {
  let path = "";
  const c = new NessieClient({ baseUrl: "https://fixture.invalid", apiKey: "fixture-key", fetchImpl: async (url) => { path = new URL(String(url)).pathname; return Response.json([{ _id: "merchant", name: "Market", category: ["Food", "Grocery"] }]); } });
  assert.equal((await c.listMerchants())[0]?.rawCategory, "Food, Grocery"); assert.equal(path, "/merchants");
});
it("malformed provider lists and money never become successful empty results", async () => {
  await assert.rejects(client({ error: "unexpected" }).listCustomerAccounts("customer"), kind("INVALID_RESPONSE"));
  await assert.rejects(client([{ _id: "purchase", amount: 1.001 }]).listPurchases("account"), kind("INVALID_RESPONSE"));
  await assert.rejects(client([{ bad: "merchant" }]).listMerchants(), kind("INVALID_RESPONSE"));
});
it("only a 404 maps to a missing purchase", async () => {
  assert.equal(await client({}, 404).getPurchase("purchase"), null);
  await assert.rejects(client({}, 401).getPurchase("purchase"), kind("REJECTED"));
});
it("purchase POSTs are attempted once when the result is uncertain", async () => {
  let calls = 0;
  const c = new NessieClient({ baseUrl: "https://fixture.invalid", apiKey: "fixture-key", fetchImpl: async () => { calls++; return Response.json({}, { status: 429 }); } });
  await assert.rejects(c.createPurchase({ accountId: "account", merchantId: "merchant", amountCents: 100, description: "sentinel-reference" }), kind("UNKNOWN")); assert.equal(calls, 1);
});
