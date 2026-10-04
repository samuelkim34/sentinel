import assert from "node:assert/strict";
import { it } from "node:test";
import { NessieClient, type SandboxMerchantInput } from "../src/banking/nessie-client";
import { BankOperationError } from "../src/banking/types";
import { planMerchantCatalog, populateMerchantCatalog, US_MERCHANT_CATALOG, type CatalogEntry } from "../src/banking/sandbox-merchant-catalog";

const address = { street_number: "123", street_name: "Original Street", city: "Fairfax", state: "VA", zip: "22030" };
const geocode = { lat: 38.8462, lng: -77.3064 };
type UpstreamMerchant = { _id: string; name: string; category: string; address: typeof address; geocode: typeof geocode };
const merchant = (_id: string, name: string): UpstreamMerchant => ({ _id, name, category: "Office", address, geocode });
const catalog: readonly CatalogEntry[] = [
  { name: "Staples", category: "OFFICE" }, { name: "Target", category: "OTHER" }, { name: "McDonald's", category: "DINING" },
];

function provider(initial: UpstreamMerchant[] = [], uncertainCreate = false) {
  const records = new Map(initial.map(item => [item._id, structuredClone(item)]));
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  let serial = 0;
  const client = new NessieClient({ baseUrl: "https://fixture.invalid", apiKey: "catalog-test-key", fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://fixture.invalid");
    assert.equal(url.searchParams.get("key"), "catalog-test-key");
    const method = init?.method ?? "GET";
    if (method === "GET") {
      if (url.pathname === "/merchants") return Response.json([...records.values()]);
      const record = records.get(decodeURIComponent(url.pathname.slice("/merchants/".length)));
      return Response.json(record ?? {}, { status: record ? 200 : 404 });
    }
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    writes.push({ method, path: url.pathname, body });
    if (method === "POST" && url.pathname === "/merchants") {
      const record = { ...body, _id: `created-${++serial}` } as UpstreamMerchant;
      records.set(record._id, record);
      if (uncertainCreate) { uncertainCreate = false; return Response.json({}, { status: 429 }); }
      return Response.json({ code: 201, objectCreated: record }, { status: 201 });
    }
    if (method === "PUT") {
      const id = decodeURIComponent(url.pathname.slice("/merchants/".length));
      assert(records.has(id));
      records.set(id, { ...records.get(id)!, ...body });
      return Response.json({ code: 202, message: "Updated" }, { status: 202 });
    }
    throw new Error(`Unexpected test request ${method} ${url.pathname}`);
  } });
  return { client, records, writes };
}

it("renames Staples in place, preserves location/category, and reruns without duplicate writes", async () => {
  const fixture = provider([merchant("old-office", "Sentinel Office Supplies"), merchant("target", " TARGET ")]);
  const original = structuredClone(fixture.records.get("old-office")!);
  assert.deepEqual(await populateMerchantCatalog(fixture.client, { catalog }), { created: 1, renamed: 1, existing: 1, dryRun: false });
  assert.deepEqual(fixture.records.get("old-office"), { ...original, name: "Staples" });
  assert.equal(fixture.records.get("target")!.name, " TARGET ");
  assert.deepEqual(fixture.writes.map(item => [item.method, item.path]), [["PUT", "/merchants/old-office"], ["POST", "/merchants"]]);
  assert.deepEqual(await populateMerchantCatalog(fixture.client, { catalog }), { created: 0, renamed: 0, existing: 3, dryRun: false });
  assert.equal(fixture.writes.length, 2);
});

it("previews the complete catalog without writing or changing existing records", async () => {
  const fixture = provider([merchant("old", "Sentinel Office Supplies")]);
  assert.deepEqual(await populateMerchantCatalog(fixture.client, { dryRun: true }), { created: 49, renamed: 1, existing: 0, dryRun: true });
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.records.get("old")!.name, "Sentinel Office Supplies");
  assert.equal(US_MERCHANT_CATALOG.length, 50);
});

it("matches names despite case and punctuation but rejects ambiguous rename or duplicate targets before writes", async () => {
  const entry = { externalId: "m", label: "McDonald’s", rawCategory: "Food" };
  assert.equal(planMerchantCatalog([entry], [catalog[2]!])[0]?.kind, "keep");
  for (const records of [
    [merchant("old", "Sentinel Office Supplies"), merchant("new", "Staples")],
    [merchant("one", "Sentinel Office Supplies"), merchant("two", "Sentinel Office Supplies")],
    [merchant("one", "Target"), merchant("two", "TARGET")],
  ]) {
    const fixture = provider(records);
    await assert.rejects(populateMerchantCatalog(fixture.client, { catalog }), /no changes were made/);
    assert.equal(fixture.writes.length, 0);
  }
});

it("stops on an uncertain write without retrying, then recognizes an already-created merchant on the next run", async () => {
  const fixture = provider([], true);
  await assert.rejects(populateMerchantCatalog(fixture.client, { catalog }), error => error instanceof BankOperationError && error.kind === "UNKNOWN");
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.records.size, 1);
  assert.deepEqual(await populateMerchantCatalog(fixture.client, { catalog }), { created: 2, renamed: 0, existing: 1, dryRun: false });
  assert.equal(fixture.records.size, 3);
  assert.equal(fixture.writes.length, 3);
});

it("refuses an incomplete scan before creating any catalog entries", async () => {
  for (const body of [
    Array.from({ length: 1001 }, (_, index) => ({ _id: String(index), name: `Existing ${index}` })),
    { data: Array.from({ length: 1000 }, (_, index) => ({ _id: String(index), name: `Existing ${index}` })), paging: { next: "/merchants?page=2" } },
  ]) {
    let calls = 0;
    const client = new NessieClient({ baseUrl: "https://fixture.invalid", apiKey: "fixture", fetchImpl: async (_url, init) => {
      calls++; assert.equal(init?.method, "GET"); return Response.json(body);
    } });
    await assert.rejects(populateMerchantCatalog(client), /scan limit/);
    assert.equal(calls, 1);
  }
});

it("does not rename a merchant whose name changed after the initial listing", async () => {
  let writes = 0;
  const client = new NessieClient({ baseUrl: "https://fixture.invalid", apiKey: "fixture", fetchImpl: async (url, init) => {
    if (init?.method !== "GET") writes++;
    return Response.json(new URL(String(url)).pathname === "/merchants" ? [merchant("old", "Sentinel Office Supplies")] : merchant("old", "Changed by someone else"));
  } });
  await assert.rejects(populateMerchantCatalog(client, { catalog }), /name changed/);
  assert.equal(writes, 0);
});

it("validates creation readback and leaves unverified writes uncertain", async () => {
  const input: SandboxMerchantInput = { name: "Staples", category: "OFFICE", address, geocode };
  for (const readback of [merchant("different-id", "Staples"), merchant("created", "Different name")]) {
    let posts = 0;
    const client = new NessieClient({ baseUrl: "https://fixture.invalid", apiKey: "fixture", fetchImpl: async (_url, init) => {
      if (init?.method === "POST") { posts++; return Response.json({ objectCreated: { _id: "created" } }, { status: 201 }); }
      return Response.json(readback);
    } });
    await assert.rejects(client.createSandboxMerchant(input), error => error instanceof BankOperationError && error.kind === "UNKNOWN");
    assert.equal(posts, 1);
  }
});
