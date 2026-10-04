import { getEnv } from "../server/env";
import { NessieClient } from "./nessie-client";
import { populateMerchantCatalog } from "./sandbox-merchant-catalog";
import { withMerchantSetupLock } from "./merchant-setup-lock";
import {
  BankOperationError,
  type BankingAdapter,
  type MerchantPage,
  type MerchantQuery,
  type ProvisionInput,
  type PurchasePage,
  type PurchaseRequest,
  type PurchaseReceipt,
} from "./types";

class UnconfiguredAdapter implements BankingAdapter {
  readonly provider = "NESSIE" as const;

  private fail(): never {
    throw new BankOperationError(
      "UNCONFIGURED",
      "NESSIE_API_KEY is not configured on the server. Sentinel will not invent account data.",
    );
  }

  getAccount(): Promise<never> { return Promise.reject(this.fail()); }
  listCustomerAccounts(): Promise<never> { return Promise.reject(this.fail()); }
  listMerchants(): Promise<MerchantPage> { return Promise.resolve({ merchants: [], supported: false }); }
  listPurchases(): Promise<PurchasePage> { return Promise.reject(this.fail()); }
  listBills(): Promise<never> { return Promise.reject(this.fail()); }
  listTransfers(): Promise<never> { return Promise.reject(this.fail()); }
  createPurchase(): Promise<never> { return Promise.reject(this.fail()); }
  getPurchase(): Promise<never> { return Promise.reject(this.fail()); }
  findPurchaseByReference(): Promise<{ supported: false }> { return Promise.resolve({ supported: false }); }
}

class NessieAdapter implements BankingAdapter {
  readonly provider = "NESSIE" as const;

  constructor(private readonly client: NessieClient) {}

  async prepareSandboxMerchants() {
    const env = getEnv();
    return withMerchantSetupLock({ baseUrl: env.NESSIE_BASE_URL, apiKey: env.NESSIE_API_KEY!, dbPath: env.SENTINEL_DB_PATH },
      () => populateMerchantCatalog(this.client));
  }

  getAccount(externalId: string) {
    return this.client.getAccount(externalId);
  }

  listCustomerAccounts(customerId: string) {
    return this.client.listCustomerAccounts(customerId);
  }

  async listMerchants(query: MerchantQuery): Promise<MerchantPage> {
    const merchants = await this.client.listMerchants(1000, { requireComplete: true });
    const filtered = merchants.filter((merchant) => {
      if (query.search && !merchant.label.toLowerCase().includes(query.search.toLowerCase())) return false;
      if (query.category && merchant.rawCategory.toLowerCase() !== query.category.toLowerCase()) return false;
      return true;
    });
    return { merchants: filtered.slice(0, query.limit), supported: true };
  }

  async listPurchases(accountId: string): Promise<PurchasePage> {
    const purchases = await this.client.listPurchases(accountId);
    return { purchases, definitive: false };
  }

  async listBills(accountId: string) {
    const bills = await this.client.listBills(accountId);
    return { bills, supported: true };
  }

  async listTransfers(accountId: string) {
    const transfers = await this.client.listTransfers(accountId);
    return { transfers, supported: true };
  }

  createPurchase(request: PurchaseRequest): Promise<PurchaseReceipt> {
    return this.client.createPurchase({
      accountId: request.accountExternalId,
      merchantId: request.merchantExternalId,
      amountCents: request.amountCents,
      description: request.description,
      simulateCompletion: request.simulateCompletion,
    });
  }

  getPurchase(externalId: string) {
    return this.client.getPurchase(externalId);
  }

  async findPurchaseByReference(accountId: string, reference: string) {
    const purchases = await this.client.listPurchases(accountId);
    const matching = purchases.filter((item) => item.reference === reference);
    const receipt = matching.length === 1 ? matching[0] : null;
    return { supported: true as const, definitive: false as const, receipt };
  }

  async createSandboxCustomer(input: ProvisionInput) {
    const customerId = await this.client.createCustomer(input);
    const account = await this.client.createAccount(customerId, {
      type: input.accountType,
      nickname: input.nickname,
      balanceCents: input.balanceCents,
    });
    const confirmed = await this.client.getAccount(account.externalId);
    return { customerId, account: confirmed };
  }
}

let override: BankingAdapter | null = null;

export function setBankingAdapterForTests(adapter: BankingAdapter | null): void {
  override = adapter;
}

export function getBankingAdapter(): BankingAdapter {
  if (override) return override;
  const env = getEnv();
  if (!env.NESSIE_API_KEY) return new UnconfiguredAdapter();
  return new NessieAdapter(new NessieClient({ baseUrl: env.NESSIE_BASE_URL, apiKey: env.NESSIE_API_KEY }));
}

export function nessieConfigured(): boolean {
  return Boolean(getEnv().NESSIE_API_KEY);
}
