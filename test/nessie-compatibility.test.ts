import { beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, testEnv, banking, receipt } from './support';
import { resetEnvCache } from '../src/server/env';
import { quoteProduct } from '../src/domain/products';
import { row, run, num } from '../src/storage/sql';
import { submitPayment, reconcilePayment } from '../src/domain/settlement';
import { setBankingAdapterForTests } from '../src/banking/adapter';
import { submitPurchase } from '../src/domain/proposals';
beforeEach(() => { testEnv(); process.env.NESSIE_WHOLE_DOLLARS_ONLY = 'false'; resetEnvCache(); });
afterEach(() => { delete process.env.NESSIE_WHOLE_DOLLARS_ONLY; resetEnvCache(); setBankingAdapterForTests(null); });
test('whole-dollar mode changes future catalog quotes visibly and still enforces user caps', () => {
  const f = fixture();
  try {
    run(f.db, "UPDATE merchant_catalog SET label = 'Staples'");
    assert.equal(quoteProduct(f.db, f.owner, 'staples-1', 1, 999).amountCents, 349);
    process.env.NESSIE_WHOLE_DOLLARS_ONLY = 'true'; resetEnvCache();
    assert.equal(quoteProduct(f.db, f.owner, 'staples-1', 1, 999).amountCents, 400);
    assert.throws(() => quoteProduct(f.db, f.owner, 'staples-1', 1, 399));
    const purchase = f.purchase();
    assert.equal(purchase.proposal.amountCents, 1500);
  } finally { f.db.close(); }
});
test('whole-dollar mode blocks fractional terms before a bank operation without rounding', () => {
  const f = fixture();
  try {
    // Fresh fixture task at revision 1, with no proposal yet.
    const p = f.purchase();
    run(f.db, 'DELETE FROM jobs'); run(f.db, 'DELETE FROM reservations'); run(f.db, 'DELETE FROM proposals');
    run(f.db, "UPDATE tasks SET state = 'IN_PROGRESS'");
    process.env.NESSIE_WHOLE_DOLLARS_ONLY = 'true'; resetEnvCache();
    const result = submitPurchase(f.db, f.ctx, { ...p.terms, amountCents: 349 }, f.now);
    assert.equal(result.state, 'BLOCKED'); assert.equal(result.amountCents, 349);
    assert.deepEqual(result.decisionCodes, ['NESSIE_WHOLE_DOLLARS_REQUIRED']);
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM payment_operations')?.n), 0);
  } finally { f.db.close(); }
});
test('a truncated receipt remains unresolved and records expected vs received amounts on creation and readback', async () => {
  const f = fixture();
  try {
    let writes = 0;
    let reference = '';
    const adapter = banking(async input => { writes++; reference = input.sentinelReference; return { ...receipt('PENDING', reference), amountCents: 1400 }; });
    adapter.findPurchaseByReference = async () => ({ supported: true, definitive: false, receipt: { ...receipt('PENDING', reference), amountCents: 1400 } });
    setBankingAdapterForTests(adapter);
    const p = f.purchase();
    await submitPayment(f.db, p.proposal.id, f.now);
    await reconcilePayment(f.db, p.proposal.id, f.now + 1000);
    const operation = row(f.db, 'SELECT * FROM payment_operations')!;
    assert.equal(writes, 1); assert.equal(operation.state, 'RECONCILE_REQUIRED');
    assert.match(String(operation.detail), /expected 15.00 USD; bank returned 14.00 USD/);
    assert.equal(operation.receipt_applied, 0);
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM reservations')?.n), 1);
    assert.equal(row(f.db, 'SELECT policy_balance_cents FROM wallets')?.policy_balance_cents, 10000);
  } finally { f.db.close(); }
});
