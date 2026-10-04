export type NormalizedAccount = {
  externalId: string;
  customerExternalId: string;
  label: string;
  currency: "USD";
  balanceCents: number;
  observedAt: number;
  responseId: string | null;
};

export type MerchantRecord = {
  externalId: string;
  label: string;
  rawCategory: string;
};

export type MerchantQuery = {
  category?: string;
  search?: string;
  limit: number;
};

export type MerchantPage = {
  merchants: MerchantRecord[];
  supported: boolean;
};

export type PurchaseRequest = {
  accountExternalId: string;
  merchantExternalId: string;
  amountCents: number;
  currency: "USD";
  simulateCompletion?: boolean;
  sentinelReference: string;
  description: string;
};

export type PurchaseReceipt = {
  externalId: string | null;
  state: "PENDING" | "COMPLETED" | "REJECTED" | "UNKNOWN";
  amountCents: number | null;
  merchantExternalId: string | null;
  accountExternalId: string | null;
  reference: string | null;
  responseId: string | null;
};

export type PurchasePage = {
  purchases: PurchaseReceipt[];
  definitive: boolean;
};

export type BillRecord = {
  externalId: string;
  status: string;
  amountCents: number | null;
};

export type BillPage = {
  bills: BillRecord[];
  supported: boolean;
};

export type TransferRecord = {
  externalId: string;
  status: string;
  amountCents: number | null;
};

export type TransferPage = {
  transfers: TransferRecord[];
  supported: boolean;
};

export type ProvisionInput = {
  firstName: string;
  lastName: string;
  streetNumber: string;
  streetName: string;
  city: string;
  state: string;
  zip: string;
  accountType: "Checking" | "Savings";
  nickname: string;
  balanceCents: number;
};

export interface BankingAdapter {
  readonly provider: "NESSIE";
  getAccount(externalId: string): Promise<NormalizedAccount>;
  listCustomerAccounts(customerId: string): Promise<NormalizedAccount[]>;
  listMerchants(query: MerchantQuery): Promise<MerchantPage>;
  prepareSandboxMerchants?(): Promise<{ created: number; renamed: number; existing: number }>;
  listPurchases(accountId: string, cursor?: string): Promise<PurchasePage>;
  listBills(accountId: string): Promise<BillPage>;
  listTransfers(accountId: string): Promise<TransferPage>;
  createPurchase(request: PurchaseRequest): Promise<PurchaseReceipt>;
  getPurchase(externalId: string): Promise<PurchaseReceipt | null>;
  findPurchaseByReference(accountId: string, reference: string): Promise<
    { supported: false } | { supported: true; definitive: false; receipt: PurchaseReceipt | null }
  >;
  createSandboxCustomer?(input: ProvisionInput): Promise<{ customerId: string; account: NormalizedAccount }>;
}

export class BankOperationError extends Error {
  constructor(
    readonly kind: "TIMEOUT" | "REJECTED" | "NOT_FOUND" | "UNKNOWN" | "UNAVAILABLE" | "INVALID_RESPONSE" | "UNCONFIGURED",
    message: string,
  ) {
    super(message);
    this.name = "BankOperationError";
  }
}
