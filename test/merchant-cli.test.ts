import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "node:test";

it("the real catalog CLI loads local configuration, previews, applies and reruns without creating a database or duplicate merchants", () => {
  const directory = mkdtempSync(join(tmpdir(), "sentinel-merchant-cli-"));
  try {
    const fixturePath = join(directory, "bank.json");
    const preloadPath = join(directory, "provider.mjs");
    writeFileSync(join(directory, ".env.local"), "NESSIE_API_KEY=isolated-merchant-cli-key\nNESSIE_BASE_URL=https://fixture.invalid\nSENTINEL_DB_PATH=data/not-created.sqlite\n");
    const address = { street_number: "123", street_name: "Original Street", city: "Fairfax", state: "VA", zip: "22030" };
    writeFileSync(fixturePath, JSON.stringify({
      records: [{ _id: "old-id", name: "Sentinel Office Supplies", category: "Office", address, geocode: { lat: 38, lng: -77 } }, { _id: "target-id", name: "Target", category: "Retail" }], writes: [],
    }));
    writeFileSync(preloadPath, `
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.env.SENTINEL_MERCHANT_FIXTURE;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://fixture.invalid');
  assert.equal(url.searchParams.get('key'), 'isolated-merchant-cli-key');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const method = init?.method ?? 'GET';
  if (method === 'GET') {
    if (url.pathname === '/merchants') return Response.json(data.records);
    const record = data.records.find(item => item._id === decodeURIComponent(url.pathname.slice('/merchants/'.length)));
    return Response.json(record ?? {}, { status: record ? 200 : 404 });
  }
  const body = JSON.parse(String(init.body));
  data.writes.push({ method, path: url.pathname });
  let record;
  if (method === 'POST') {
    assert.equal(url.pathname, '/merchants');
    record = { ...body, _id: 'created-' + data.records.length };
    data.records.push(record);
  } else {
    assert.equal(method, 'PUT');
    record = data.records.find(item => item._id === decodeURIComponent(url.pathname.slice('/merchants/'.length)));
    assert(record);
    Object.assign(record, body);
  }
  writeFileSync(path, JSON.stringify(data));
  return Response.json({ objectCreated: record }, { status: method === 'POST' ? 201 : 202 });
};
`);
    const environment: NodeJS.ProcessEnv = { ...process.env, SENTINEL_MERCHANT_FIXTURE: fixturePath };
    for (const key of ["NESSIE_API_KEY", "NESSIE_BASE_URL", "SENTINEL_DB_PATH", "NODE_OPTIONS"]) delete environment[key];
    const tsx = createRequire(resolve("package.json")).resolve("tsx");
    const execute = (args: string[]) => spawnSync(process.execPath, ["--import", tsx, "--import", preloadPath, resolve("scripts/populate-merchants.ts"), ...args], { cwd: directory, env: environment, encoding: "utf8", timeout: 30000 });
    const preview = execute(["--dry-run"]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /Planned: 48 new, 1 renamed, 1 already present/);
    assert.equal(JSON.parse(readFileSync(fixturePath, "utf8")).writes.length, 0);
    const apply = execute([]);
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(apply.stdout, /Done: 48 new, 1 renamed, 1 already present/);
    const rerun = execute([]);
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.match(rerun.stdout, /Done: 0 new, 0 renamed, 50 already present/);
    const saved = JSON.parse(readFileSync(fixturePath, "utf8")) as { records: Array<{ _id: string; name: string; address: unknown }>; writes: unknown[] };
    assert.equal(saved.records.length, 50);
    assert.equal(saved.writes.length, 49);
    assert.equal(saved.records.find(item => item._id === "old-id")?.name, "Staples");
    assert.deepEqual(saved.records.find(item => item._id === "old-id")?.address, address);
    assert.deepEqual(readdirSync(join(directory, "data")), []);
    assert(!apply.stdout.includes("isolated-merchant-cli-key"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
