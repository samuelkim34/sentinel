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

it("merchant sync reads wrapped pages and keeps pagination on the configured HTTPS origin", async () => {
  const requested: URL[] = [];
  const c = new NessieClient({ baseUrl: "https://fixture.invalid", apiKey: "fixture-key", fetchImpl: async input => {
    const url = new URL(String(input)); requested.push(url);
    return Response.json(requested.length === 1 ? { data: [{ _id: "one", name: "First", category: "Food" }], paging: { next: "http://fixture.invalid/merchants?page=2&key=other-key" } } : { data: [{ _id: "two", name: "Second", category: ["Office"] }], paging: { next: null } });
  } });
  assert.deepEqual((await c.listMerchants()).map(item => item.externalId), ["one", "two"]);
  assert.equal(requested.length, 2);
  assert.equal(requested[1]?.origin, "https://fixture.invalid");
  assert.equal(requested[1]?.searchParams.get("key"), "fixture-key");
});

it("merchant pagination refuses other hosts, credentials and unrelated bank routes", async () => {
  for (const next of ["https://other.invalid/merchants", "/accounts", "https://user:secret@fixture.invalid/merchants"]) {
    let calls = 0;
    const c = new NessieClient({ baseUrl: "https://fixture.invalid", apiKey: "fixture-key", fetchImpl: async () => { calls++; return Response.json({ data: [], paging: { next } }); } });
    await assert.rejects(c.listMerchants(), kind("INVALID_RESPONSE")); assert.equal(calls, 1);
  }
});

it("merchant pagination detects cycles and stops at the requested count", async () => {
  let calls = 0;
  const c = new NessieClient({ baseUrl: "https://fixture.invalid", apiKey: "fixture-key", fetchImpl: async () => { calls++; return Response.json({ data: [{ _id: "one", name: "First" }], paging: { next: "/merchants?page=1" } }); } });
  assert.equal((await c.listMerchants(1)).length, 1); assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(c.listMerchants(), kind("INVALID_RESPONSE")); assert.equal(calls, 2);
  await assert.rejects(client({ data: null }).listMerchants(), kind("INVALID_RESPONSE"));
});

it('purchase creation includes pending status and exact USD amount', async () => {
  const c = new NessieClient({ baseUrl: 'https://fixture.invalid', apiKey: 'fixture-key', fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.status, 'pending'); assert.equal(body.amount, 3.49);
    return Response.json({ objectCreated: { ...body, _id: 'purchase', payer_id: 'account' } }, { status: 201 });
  } });
  const receipt = await c.createPurchase({ accountId: 'account', merchantId: 'merchant', amountCents: 349, description: 'reference' });
  assert.equal(receipt.state, 'PENDING'); assert.equal(receipt.amountCents, 349);
});
