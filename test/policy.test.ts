import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluatePolicy, type PolicyInput } from "../src/domain/policy";

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  const now = 1_700_000_000_000;
  return {
    now,
    freshnessMs: 60_000,
    mode: "new",
    member: true,
    registrationState: "ACTIVE",
    connectionAllowsWork: true,
    taskMatches: true,
    mandate: {
      id: "m1",
      state: "ACTIVE",
      expiresAt: now + 86_400_000,
      walletId: "w1",
      registrationId: "r1",
      controllerUserId: "u1",
      totalAllowanceCents: 10_000,
      perPurchaseLimitCents: 5_000,
      reviewAboveCents: 2_000,
      allowedCategories: ["GROCERIES"],
      allowedMerchantIds: null,
      executionMode: "AUTO_WITHIN_LIMITS",
    },
    expectedWalletId: "w1",
    expectedRegistrationId: "r1",
    expectedControllerUserId: "u1",
    merchantId: "merch",
    merchantFound: true,
    verifiedCategory: "GROCERIES",
    wallet: { state: "ACTIVE", policyBalanceCents: 8_000, lastVerifiedAt: now },
    protectionsCents: 0,
    reservations: [],
    completedCommitmentCents: 0,
    amountCents: 1_500,
    ...overrides,
  };
}

describe("policy", () => {
  it("reserves inside the review threshold", () => {
    const result = evaluatePolicy(input());
    assert.equal(result.outcome, "RESERVED");
  });

  it("requires review above the threshold and for propose-only", () => {
    assert.equal(evaluatePolicy(input({ amountCents: 2_001 })).outcome, "REVIEW_REQUIRED");
    const mandate = input().mandate!;
    assert.equal(evaluatePolicy(input({ mandate: { ...mandate, executionMode: "PROPOSE_ONLY" }, amountCents: 100 })).outcome, "REVIEW_REQUIRED");
  });

  it("blocks protected funds, allowance, category, and stale observations", () => {
    assert.ok(evaluatePolicy(input({ protectionsCents: 7_000, amountCents: 1_500 })).codes.includes("PROTECTED_FUNDS"));
    assert.ok(evaluatePolicy(input({ completedCommitmentCents: 9_000, amountCents: 1_500 })).codes.includes("MANDATE_ALLOWANCE"));
    assert.ok(evaluatePolicy(input({ verifiedCategory: "TRAVEL" })).codes.includes("CATEGORY_NOT_ALLOWED"));
    assert.ok(evaluatePolicy(input({ verifiedCategory: "UNKNOWN" })).codes.includes("CATEGORY_UNVERIFIED"));
    const stale = input();
    assert.ok(evaluatePolicy(input({ wallet: { ...stale.wallet!, lastVerifiedAt: stale.now - 120_000 } })).codes.includes("BANK_STATE_STALE"));
  });

  it("does not count the proposal's own reservation twice", () => {
    const result = evaluatePolicy(input({
      mode: "existing",
      ownProposalId: "p1",
      amountCents: 1_500,
      reservations: [{ proposalId: "p1", mandateId: "m1", amountCents: 1_500 }],
    }));
    assert.equal(result.outcome, "RESERVED");
  });
});
