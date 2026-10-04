import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SANDBOX_PRODUCTS, searchProducts } from '../src/banking/sandbox-products';
import { US_MERCHANT_CATALOG } from '../src/banking/sandbox-merchant-catalog';
import { listProducts, quoteProduct } from '../src/domain/products';
import { fixture, testEnv } from './support';
import { run } from '../src/storage/sql';
beforeEach(testEnv);
test('catalog covers all 50 merchants with unique IDs and positive integer USD prices', () => {
  assert.equal(SANDBOX_PRODUCTS.length, 100);
  assert.equal(new Set(SANDBOX_PRODUCTS.map(p => p.id)).size, 100);
  for (const merchant of US_MERCHANT_CATALOG) assert.equal(SANDBOX_PRODUCTS.filter(p => p.merchant === merchant.name).length, 2);
  assert.ok(SANDBOX_PRODUCTS.every(p => Number.isSafeInteger(p.unitPriceCents) && p.unitPriceCents > 0));
  assert.equal(searchProducts('staples eraser')[0]?.id, 'staples-1');
});
test('product quotes use synced merchant and authoritative prices; reject unavailable, ambiguous and over-budget selections', () => {
  const f = fixture();
  try {
    assert.equal(listProducts(f.db, f.owner, 'eraser')[0]?.available, false);
    assert.throws(() => quoteProduct(f.db, f.owner, 'staples-1', 1, 1000));
    run(f.db, "UPDATE merchant_catalog SET label = 'Staples' WHERE id = 'merchant'");
    const quote = quoteProduct(f.db, f.owner, 'staples-1', 2, 1000);
    assert.equal(quote.amountCents, 698); assert.equal(quote.merchantId, 'merchant');
    assert.match(quote.reason, /unit 349/);
    assert.throws(() => quoteProduct(f.db, f.owner, 'staples-1', 3, 1000));
    assert.throws(() => quoteProduct(f.db, f.owner, 'staples-1', 0, 1000));
    assert.throws(() => quoteProduct(f.db, f.owner, 'staples-1', 1.5, 1000));
    run(f.db, "INSERT INTO merchant_catalog (id, upstream_merchant_id, label, raw_category, verified_category, last_synced_at) VALUES ('duplicate', 'duplicate', 'STAPLES', 'Office', 'UNKNOWN', ?)", [f.now]);
    assert.throws(() => quoteProduct(f.db, f.owner, 'staples-1', 1, 1000));
    assert.throws(() => listProducts(f.db, { ...f.owner, userId: 'outsider' }));
  } finally { f.db.close(); }
});
