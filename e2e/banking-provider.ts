// Loaded only by the explicit, isolated form-regression browser configuration.
export {};
if (process.env.NESSIE_API_KEY !== 'isolated-forms-test-key' || !process.env.SENTINEL_DB_PATH?.includes('sentinel-e2e-')) throw new Error('Banking fixture requires an isolated form-test configuration.');
const actualFetch = globalThis.fetch;
const accounts = new Map<string, Record<string, unknown>>();
const merchants = new Map<string, Record<string, unknown>>();
let customers = 0, accountSequence = 0, merchantSyncs = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (url.origin !== 'https://api.nessieisreal.com') return actualFetch(input, init);
  if (url.searchParams.get('key') !== 'isolated-forms-test-key') throw new Error('Unexpected banking fixture key.');
  const method = init?.method ?? 'GET';
  if (method === 'POST' && url.pathname === '/merchants') {
    const id = `setup-${merchants.size}`;
    const merchant = { ...JSON.parse(String(init?.body)), _id: id };
    merchants.set(id, merchant);
    return Response.json({ objectCreated: merchant }, { status: 201 });
  }
  if (method === 'GET' && url.pathname.startsWith('/merchants/')) {
    const merchant = merchants.get(url.pathname.split('/')[2]);
    return Response.json(merchant ?? {}, { status: merchant ? 200 : 404 });
  }
  if (method === 'POST' && url.pathname === '/customers') return Response.json({ objectCreated: { _id: `forms-customer-${++customers}` } }, { status: 201 });
  if (method === 'POST' && /^\/customers\/[^/]+\/accounts$/.test(url.pathname)) {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (body.nickname === 'Reject account') return Response.json({ message: 'Controlled rejection' }, { status: 400 });
    const id = `forms-account-${++accountSequence}`;
    accounts.set(id, { _id: id, customer_id: url.pathname.split('/')[2], ...body });
    return Response.json({ objectCreated: { _id: id } }, { status: 201 });
  }
  if (method === 'GET' && url.pathname.startsWith('/accounts/')) {
    const account = accounts.get(url.pathname.split('/')[2]);
    return account ? Response.json(account) : Response.json({}, { status: 404 });
  }
  if (method === 'GET' && url.pathname === '/merchants') {
    if (merchants.size) return Response.json([...merchants.values()]);
    if (url.searchParams.get('page') === '2') return Response.json({ data: [{ _id: 'forms-merchant-two', name: 'Second bank merchant', category: 'Office' }], paging: { next: null } });
    merchantSyncs++;
    if (merchantSyncs === 2) return Response.json({ message: 'Controlled invalid-key response' }, { status: 401 });
    if (merchantSyncs > 2) return Response.json([]);
    return Response.json({ data: [{ _id: 'forms-merchant-one', name: 'First bank merchant', category: ['Food', 'Grocery'] }], paging: { next: '/merchants?page=2' } });
  }
  throw new Error('Unexpected banking call in form tests.');
};
