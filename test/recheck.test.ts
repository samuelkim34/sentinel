import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, testEnv, banking } from './support';
import { recheckBlockedProposal } from '../src/domain/proposals';
import { setBankingAdapterForTests } from '../src/banking/adapter';
import { run, row, num } from '../src/storage/sql';
beforeEach(() => { testEnv(); setBankingAdapterForTests(banking(async () => { throw new Error('No bank writes permitted'); })); });
afterEach(() => setBankingAdapterForTests(null));
function blocked() {
  const f = fixture();
  run(f.db, 'UPDATE wallets SET last_verified_at = ?', [f.now - 120000]);
  const p = f.purchase();
  assert.equal(p.proposal.state, 'BLOCKED');
  return { ...f, ...p };
}
test('refresh and recheck reserves the original proposal once, without a bank POST', async () => {
  const f = blocked();
  try {
    const result = await recheckBlockedProposal(f.db, f.owner, f.proposal.id, f.proposal.termsHash);
    assert.equal(result.id, f.proposal.id); assert.equal(result.state, 'RESERVED');
    assert.equal(result.amountCents, 1500);
    await assert.rejects(recheckBlockedProposal(f.db, f.owner, f.proposal.id, f.proposal.termsHash));
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM proposals')?.n), 1);
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM reservations')?.n), 1);
    assert.equal(num(row(f.db, "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'payment'")?.n), 1);
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM payment_operations')?.n), 0);
  } finally { f.db.close(); }
});
test('recheck keeps human approval and other hard limits in force', async () => {
  const f = blocked();
  try {
    run(f.db, "UPDATE mandates SET execution_mode = 'PROPOSE_ONLY'");
    const result = await recheckBlockedProposal(f.db, f.owner, f.proposal.id, f.proposal.termsHash);
    assert.equal(result.state, 'REVIEW_REQUIRED');
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM reservations')?.n), 0);
  } finally { f.db.close(); }
  const g = blocked();
  try {
    run(g.db, "UPDATE mandates SET state = 'REVOKED'");
    const result = await recheckBlockedProposal(g.db, g.owner, g.proposal.id, g.proposal.termsHash);
    assert.equal(result.state, 'BLOCKED'); assert.ok(result.decisionCodes.includes('MANDATE_REVOKED'));
  } finally { g.db.close(); }
});
test('failed refresh and changed permissions cannot reserve funds', async () => {
  const f = blocked();
  try {
    const adapter = banking(async () => { throw new Error('No writes'); });
    adapter.getAccount = async () => { throw new Error('Bank offline'); };
    setBankingAdapterForTests(adapter);
    await assert.rejects(recheckBlockedProposal(f.db, f.owner, f.proposal.id, f.proposal.termsHash));
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM reservations')?.n), 0);
    await assert.rejects(recheckBlockedProposal(f.db, { ...f.owner, workspaceId: 'other' }, f.proposal.id, f.proposal.termsHash));
    await assert.rejects(recheckBlockedProposal(f.db, f.owner, f.proposal.id, 'wrong hash'));
  } finally { f.db.close(); }
});
test('concurrent rechecks produce one reservation; a state change during refresh wins', async () => {
  const f = blocked();
  try {
    const results = await Promise.allSettled([recheckBlockedProposal(f.db, f.owner, f.proposal.id, f.proposal.termsHash), recheckBlockedProposal(f.db, f.owner, f.proposal.id, f.proposal.termsHash)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(num(row(f.db, 'SELECT COUNT(*) AS n FROM reservations')?.n), 1);
  } finally { f.db.close(); }
  const g = blocked();
  try {
    const adapter = banking(async () => { throw new Error('No writes'); });
    const read = adapter.getAccount;
    adapter.getAccount = async id => { run(g.db, "UPDATE proposals SET state = 'CANCELLED'"); return read(id); };
    setBankingAdapterForTests(adapter);
    await assert.rejects(recheckBlockedProposal(g.db, g.owner, g.proposal.id, g.proposal.termsHash));
    assert.equal(num(row(g.db, 'SELECT COUNT(*) AS n FROM reservations')?.n), 0);
  } finally { g.db.close(); }
});
test('recheck refuses any existing payment operation even if a proposal is marked blocked', async () => {
  const f = blocked();
  try {
    run(f.db, "INSERT INTO payment_operations (id, proposal_id, wallet_id, upstream_reference, state, submission_count) VALUES ('op', ?, 'wallet', 'ref', 'RECONCILE_REQUIRED', 1)", [f.proposal.id]);
    await assert.rejects(recheckBlockedProposal(f.db, f.owner, f.proposal.id, f.proposal.termsHash));
  } finally { f.db.close(); }
});
