import { sumCents } from "../contracts/money";
import type { MerchantCategory } from "../contracts/constants";

export type PolicyOutcome = "BLOCKED" | "REVIEW_REQUIRED" | "RESERVED";

export type ReservationView = {
  proposalId: string;
  mandateId: string;
  amountCents: number;
};

export type PolicyInput = {
  now: number;
  freshnessMs: number;
  mode: "new" | "existing";
  member: boolean;
  registrationState: "ACTIVE" | "PAUSED" | "ARCHIVED";
  connectionAllowsWork: boolean;
  taskMatches: boolean;
  mandate: {
    id: string;
    state: "ACTIVE" | "REVOKED" | "EXPIRED";
    expiresAt: number;
    walletId: string;
    registrationId: string;
    controllerUserId: string;
    totalAllowanceCents: number;
    perPurchaseLimitCents: number;
    reviewAboveCents: number;
    allowedCategories: readonly string[];
    allowedMerchantIds: readonly string[] | null;
    executionMode: "PROPOSE_ONLY" | "AUTO_WITHIN_LIMITS";
  } | null;
  expectedWalletId: string;
  expectedRegistrationId: string;
  expectedControllerUserId: string;
  merchantId: string;
  merchantFound: boolean;
  verifiedCategory: MerchantCategory | null;
  wallet: {
    state: "ACTIVE" | "QUARANTINED";
    policyBalanceCents: number;
    lastVerifiedAt: number;
  } | null;
  protectionsCents: number;
  reservations: readonly ReservationView[];
  completedCommitmentCents: number;
  amountCents: number;
  ownProposalId?: string;
};

export type PolicyDecision = {
  outcome: PolicyOutcome;
  codes: string[];
  availableCents: number | null;
  explanation: string;
};

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const codes: string[] = [];
  if (!input.member) codes.push("MEMBERSHIP_REQUIRED");
  if (input.registrationState === "PAUSED") codes.push("REGISTRATION_PAUSED");
  if (input.registrationState === "ARCHIVED") codes.push("REGISTRATION_ARCHIVED");
  if (!input.connectionAllowsWork) codes.push("CONNECTION_INACTIVE");
  if (!input.taskMatches) codes.push("TASK_BINDING");

  const mandate = input.mandate;
  if (!mandate) {
    codes.push("MANDATE_MISSING");
  } else if (
    mandate.walletId !== input.expectedWalletId ||
    mandate.registrationId !== input.expectedRegistrationId ||
    mandate.controllerUserId !== input.expectedControllerUserId
  ) {
    codes.push("MANDATE_BINDING");
  } else if (mandate.state === "REVOKED") {
    codes.push("MANDATE_REVOKED");
  } else if (mandate.state === "EXPIRED" || mandate.expiresAt <= input.now) {
    codes.push("MANDATE_EXPIRED");
  } else if (mandate.state !== "ACTIVE") {
    codes.push("MANDATE_INACTIVE");
  }

  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) codes.push("INVALID_AMOUNT");
  if (!input.merchantFound) codes.push("MERCHANT_UNKNOWN");
  else if (!input.verifiedCategory || input.verifiedCategory === "UNKNOWN") codes.push("CATEGORY_UNVERIFIED");
  else if (mandate && !mandate.allowedCategories.includes(input.verifiedCategory)) codes.push("CATEGORY_NOT_ALLOWED");
  if (mandate?.allowedMerchantIds && !mandate.allowedMerchantIds.includes(input.merchantId)) {
    codes.push("MERCHANT_NOT_ALLOWED");
  }

  const ownId = input.mode === "existing" ? input.ownProposalId : undefined;
  const otherReservations = input.reservations.filter((item) => item.proposalId !== ownId);
  const reservedOther = sumCents(otherReservations.map((item) => item.amountCents));
  const mandateId = mandate?.id;
  const otherMandateHolds = sumCents(
    otherReservations.filter((item) => item.mandateId === mandateId).map((item) => item.amountCents),
  );
  const wallet = input.wallet;
  let spendable = 0;
  if (!wallet) {
    codes.push("WALLET_MISSING");
  } else {
    if (wallet.state === "QUARANTINED") codes.push("RECONCILIATION_REQUIRED");
    if (input.now - wallet.lastVerifiedAt > input.freshnessMs) codes.push("BANK_STATE_STALE");
    spendable = Math.max(0, wallet.policyBalanceCents - input.protectionsCents - reservedOther);
    if (wallet.state !== "QUARANTINED" && input.amountCents > spendable) {
      const beforeProtections = Math.max(0, wallet.policyBalanceCents - reservedOther);
      const beforeReservations = Math.max(0, wallet.policyBalanceCents - input.protectionsCents);
      if (input.protectionsCents > 0 && input.amountCents > spendable && input.amountCents <= beforeProtections) {
        codes.push("PROTECTED_FUNDS");
      } else if (reservedOther > 0 && input.amountCents <= beforeReservations) {
        codes.push("RESERVED_BY_OTHER_WORK");
      } else {
        if (input.protectionsCents > 0) codes.push("PROTECTED_FUNDS");
        if (reservedOther > 0) codes.push("RESERVED_BY_OTHER_WORK");
        if (codes.at(-1) !== "PROTECTED_FUNDS" && codes.at(-1) !== "RESERVED_BY_OTHER_WORK") codes.push("INSUFFICIENT_FUNDS");
      }
    }
  }

  const allowanceRemaining = mandate ? mandate.totalAllowanceCents - input.completedCommitmentCents - otherMandateHolds : 0;
  if (mandate && input.amountCents > mandate.perPurchaseLimitCents) codes.push("PER_PURCHASE_LIMIT");
  if (mandate && input.amountCents > allowanceRemaining) codes.push("MANDATE_ALLOWANCE");
  if (input.mode === "existing") {
    const own = input.reservations.find((item) => item.proposalId === input.ownProposalId);
    if (!own || own.amountCents !== input.amountCents) codes.push("RESERVATION_MISSING");
  }

  const available = Math.max(
    0,
    Math.min(
      spendable,
      Math.max(0, allowanceRemaining),
      mandate ? mandate.perPurchaseLimitCents : 0,
    ),
  );

  if (codes.length > 0) {
    return {
      outcome: "BLOCKED",
      codes: [...new Set(codes)],
      availableCents: available,
      explanation: explain(codes[0]!, available),
    };
  }

  if (!mandate) {
    return { outcome: "BLOCKED", codes: ["MANDATE_MISSING"], availableCents: 0, explanation: explain("MANDATE_MISSING", 0) };
  }
  if (input.mode === "existing") {
    return {
      outcome: "RESERVED",
      codes: ["EXISTING_RESERVATION_OK"],
      availableCents: available,
      explanation: "The existing reservation still fits the current limits.",
    };
  }
  if (mandate.executionMode === "PROPOSE_ONLY") {
    return {
      outcome: "REVIEW_REQUIRED",
      codes: ["PROPOSE_ONLY"],
      availableCents: available,
      explanation: "This mandate requires a person to review every purchase. Funds will be checked again at approval.",
    };
  }
  if (input.amountCents > mandate.reviewAboveCents) {
    return {
      outcome: "REVIEW_REQUIRED",
      codes: ["REVIEW_THRESHOLD"],
      availableCents: available,
      explanation: "The amount is above the review threshold. Funds will be checked again at approval.",
    };
  }
  return {
    outcome: "RESERVED",
    codes: ["AUTO_WITHIN_LIMITS"],
    availableCents: Math.max(0, available - input.amountCents),
    explanation: "Hard limits passed and the mandate allows submission without another approval.",
  };
}

function explain(code: string, availableCents: number): string {
  const money = (availableCents / 100).toFixed(2);
  switch (code) {
    case "MANDATE_EXPIRED":
      return "The spending mandate has expired.";
    case "MANDATE_REVOKED":
    case "MANDATE_INACTIVE":
    case "MANDATE_MISSING":
      return "There is no active spending mandate for this purchase.";
    case "REGISTRATION_PAUSED":
      return "The registration is paused, so new purchases are blocked.";
    case "REGISTRATION_ARCHIVED":
      return "The registration is archived.";
    case "CATEGORY_NOT_ALLOWED":
      return "The merchant category is outside this mandate.";
    case "CATEGORY_UNVERIFIED":
      return "The merchant category has not been confirmed, so a category-restricted purchase is blocked.";
    case "MERCHANT_NOT_ALLOWED":
    case "MERCHANT_UNKNOWN":
      return "That merchant is not in the authorized catalog for this mandate.";
    case "PER_PURCHASE_LIMIT":
      return `The amount exceeds the per-purchase cap. Available under the current limits is $${money}.`;
    case "MANDATE_ALLOWANCE":
      return `The amount exceeds the remaining lifetime allowance. Available under the current limits is $${money}.`;
    case "PROTECTED_FUNDS":
      return `Protected funds leave $${money} available for new purchases.`;
    case "RESERVED_BY_OTHER_WORK":
      return `Other commitments already reserve funds. Available for a new purchase is $${money}.`;
    case "INSUFFICIENT_FUNDS":
      return `The wallet does not have enough spendable funds. Available is $${money}.`;
    case "BANK_STATE_STALE":
      return "The account observation is too old for a new payment decision.";
    case "RECONCILIATION_REQUIRED":
      return "This account is quarantined until a person resolves the banking discrepancy.";
    case "RESERVATION_MISSING":
      return "The existing reservation no longer matches these terms.";
    case "TASK_BINDING":
    case "MANDATE_BINDING":
      return "The task, registration, controller, or account does not match the granted authority.";
    case "CONNECTION_INACTIVE":
      return "This connection cannot start new work.";
    case "MEMBERSHIP_REQUIRED":
      return "The requester is no longer a member of the workspace.";
    default:
      return "The purchase did not satisfy the current financial controls.";
  }
}
