import { z } from "zod";
import { centsToDollarNumber, dollarsToCents } from "../contracts/money";
import { BankOperationError, type NormalizedAccount, type PurchaseReceipt } from "./types";

const accountSchema = z.object({
  _id: z.string().min(1),
  nickname: z.string().optional().default("Sandbox account"),
  type: z.string().optional(),
  balance: z.number(),
  customer_id: z.string().min(1),
}).passthrough();

const purchaseSchema = z.object({
  _id: z.string().optional(),
  merchant_id: z.string().optional(),
  payer_id: z.string().optional(),
  amount: z.number().optional(),
  status: z.string().optional(),
  description: z.string().optional(),
}).passthrough();

const merchantSchema = z.object({
  _id: z.string().min(1),
  name: z.string().optional().default("Merchant"),
  category: z.union([z.string(), z.array(z.string())]).optional().default("unknown"),
}).passthrough();

const createdSchema = z.object({
  code: z.number().optional(),
  message: z.string().optional(),
  objectCreated: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export type NessieClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export class NessieClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: NessieClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  async getAccount(accountId: string): Promise<NormalizedAccount> {
    const body = await this.request("GET", `/accounts/${encodeURIComponent(accountId)}`);
    return this.normalizeAccount(body);
  }

  async listCustomerAccounts(customerId: string): Promise<NormalizedAccount[]> {
    const body = await this.request("GET", `/customers/${encodeURIComponent(customerId)}/accounts`);
    const list = requireList(body);
    return list.map((item) => this.normalizeAccount(item));
  }

  async createCustomer(input: {
    firstName: string;
    lastName: string;
    streetNumber: string;
    streetName: string;
    city: string;
    state: string;
    zip: string;
  }): Promise<string> {
    const body = await this.request("POST", "/customers", {
      first_name: input.firstName,
      last_name: input.lastName,
      address: {
        street_number: input.streetNumber,
        street_name: input.streetName,
        city: input.city,
        state: input.state,
        zip: input.zip,
      },
    });
    const created = createdSchema.safeParse(body);
    const objectId = created.success ? stringField(created.data.objectCreated?._id) : null;
    const direct = accountLikeId(body);
    const id = objectId || direct;
    if (!id) throw new BankOperationError("INVALID_RESPONSE", "Nessie did not return a customer id.");
    return id;
  }

  async createAccount(customerId: string, input: {
    type: "Checking" | "Savings";
    nickname: string;
    balanceCents: number;
  }): Promise<NormalizedAccount> {
    const body = await this.request("POST", `/customers/${encodeURIComponent(customerId)}/accounts`, {
      type: input.type,
      nickname: input.nickname,
      rewards: 0,
      balance: centsToDollarNumber(input.balanceCents),
    });
    const created = createdSchema.safeParse(body);
    const createdId = created.success ? stringField(created.data.objectCreated?._id) : null;
    if (createdId) return this.getAccount(createdId);
    return this.normalizeAccount(body);
  }

  async listMerchants(): Promise<Array<{ externalId: string; label: string; rawCategory: string }>> {
    const body = await this.request("GET", "/merchants");
    return requireList(body).map((item) => this.normalizeMerchant(item));
  }

  async getMerchant(merchantId: string): Promise<{ externalId: string; label: string; rawCategory: string }> {
    const body = await this.request("GET", `/merchants/${encodeURIComponent(merchantId)}`);
    return this.normalizeMerchant(body);
  }

  async listPurchases(accountId: string): Promise<PurchaseReceipt[]> {
    const body = await this.request("GET", `/accounts/${encodeURIComponent(accountId)}/purchases`);
    return requireList(body).map((item) => {
      const parsed = purchaseSchema.safeParse(item);
      if (!parsed.success || !parsed.data._id) throw new BankOperationError("INVALID_RESPONSE", "Nessie returned an invalid purchase.");
      return this.normalizePurchase(parsed.data, accountId);
    });
  }

  async getPurchase(purchaseId: string): Promise<PurchaseReceipt | null> {
    try {
      const body = await this.request("GET", `/purchases/${encodeURIComponent(purchaseId)}`);
      const parsed = purchaseSchema.safeParse(body);
      if (!parsed.success || !parsed.data._id) throw new BankOperationError("INVALID_RESPONSE", "Nessie returned an invalid purchase.");
      return this.normalizePurchase(parsed.data, parsed.data.payer_id ?? null);
    } catch (error) {
      if (error instanceof BankOperationError && error.kind === "NOT_FOUND") return null;
      throw error;
    }
  }

  async listBills(accountId: string): Promise<Array<{ externalId: string; status: string; amountCents: number | null }>> {
    const body = await this.request("GET", `/accounts/${encodeURIComponent(accountId)}/bills`);
    return requireList(body).map((item) => {
      const parsed = z.object({
        _id: z.string(),
        status: z.string().optional().default("unknown"),
        payment_amount: z.number().optional(),
      }).passthrough().safeParse(item);
      if (!parsed.success) throw new BankOperationError("INVALID_RESPONSE", "Nessie returned an invalid bill.");
      return {
        externalId: parsed.data._id,
        status: parsed.data.status,
        amountCents: parsed.data.payment_amount === undefined ? null : safeDollars(parsed.data.payment_amount),
      };
    });
  }

  async listTransfers(accountId: string): Promise<Array<{ externalId: string; status: string; amountCents: number | null }>> {
    const body = await this.request("GET", `/accounts/${encodeURIComponent(accountId)}/transfers`);
    return requireList(body).map((item) => {
      const parsed = z.object({
        _id: z.string(),
        status: z.string().optional().default("unknown"),
        amount: z.number().optional(),
      }).passthrough().safeParse(item);
      if (!parsed.success) throw new BankOperationError("INVALID_RESPONSE", "Nessie returned an invalid transfer.");
      return {
        externalId: parsed.data._id,
        status: parsed.data.status,
        amountCents: parsed.data.amount === undefined ? null : safeDollars(parsed.data.amount),
      };
    });
  }

  async createPurchase(input: {
    accountId: string;
    merchantId: string;
    amountCents: number;
    description: string;
  }): Promise<PurchaseReceipt> {
    const body = await this.request("POST", `/accounts/${encodeURIComponent(input.accountId)}/purchases`, {
      merchant_id: input.merchantId,
      medium: "balance",
      purchase_date: new Date().toISOString().slice(0, 10),
      amount: centsToDollarNumber(input.amountCents),
      description: input.description,
    }, { retry: false });
    const created = createdSchema.safeParse(body);
    const object = created.success ? created.data.objectCreated : undefined;
    const parsed = purchaseSchema.safeParse(object ?? body);
    if (!parsed.success || !parsed.data._id) {
      throw new BankOperationError("UNKNOWN", "Nessie accepted no verifiable purchase receipt.");
    }
    return this.normalizePurchase(parsed.data, input.accountId);
  }

  private normalizeAccount(body: unknown): NormalizedAccount {
    const parsed = accountSchema.safeParse(body);
    if (!parsed.success) {
      const created = createdSchema.safeParse(body);
      if (created.success && created.data.objectCreated) return this.normalizeAccount(created.data.objectCreated);
      throw new BankOperationError("INVALID_RESPONSE", "Nessie account response did not match the expected shape.");
    }
    return {
      externalId: parsed.data._id,
      customerExternalId: parsed.data.customer_id,
      label: parsed.data.nickname,
      currency: "USD",
      balanceCents: dollarsToCents(parsed.data.balance),
      observedAt: Date.now(),
      responseId: parsed.data._id,
    };
  }

  private normalizeMerchant(body: unknown) {
    const parsed = merchantSchema.safeParse(body);
    if (!parsed.success) throw new BankOperationError("INVALID_RESPONSE", "Nessie returned an invalid merchant.");
    return { externalId: parsed.data._id, label: parsed.data.name, rawCategory: Array.isArray(parsed.data.category) ? parsed.data.category.join(", ") : parsed.data.category };
  }

  private normalizePurchase(data: z.infer<typeof purchaseSchema>, accountId: string | null): PurchaseReceipt {
    return {
      externalId: data._id ?? null,
      state: mapStatus(data.status),
      amountCents: data.amount === undefined ? null : safeDollars(data.amount),
      merchantExternalId: data.merchant_id ?? null,
      accountExternalId: data.payer_id ?? accountId,
      reference: data.description ?? null,
      responseId: data._id ?? null,
    };
  }

  private async request(method: string, path: string, body?: unknown, options?: { retry?: boolean }): Promise<unknown> {
    const retry = options?.retry ?? method === "GET";
    let lastError: unknown;
    const attempts = retry ? 3 : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.once(method, path, body);
      } catch (error) {
        lastError = error;
        if (!retry || attempt === attempts) break;
        if (error instanceof BankOperationError && ["REJECTED", "NOT_FOUND", "INVALID_RESPONSE"].includes(error.kind)) break;
        await delay(100 * attempt + Math.floor(Math.random() * 50));
      }
    }
    throw lastError;
  }

  private async once(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    url.searchParams.set("key", this.apiKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: body ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: "error",
      });
      const textBody = await response.text();
      const parsed = textBody ? safeJson(textBody) : null;
      if (response.status === 404) throw new BankOperationError(method === "GET" ? "NOT_FOUND" : "REJECTED", "Nessie could not find that resource.");
      if ([408, 409, 425, 429].includes(response.status)) throw new BankOperationError("UNKNOWN", `Nessie returned an uncertain status (${response.status}).`);
      if (response.status >= 400 && response.status < 500) {
        throw new BankOperationError("REJECTED", `Nessie rejected the request (${response.status}).`);
      }
      if (!response.ok) throw new BankOperationError("UNKNOWN", `Nessie returned status ${response.status}.`);
      if (parsed === undefined) throw new BankOperationError("INVALID_RESPONSE", "Nessie returned a body that was not JSON.");
      return parsed;
    } catch (error) {
      if (error instanceof BankOperationError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new BankOperationError("TIMEOUT", "The Nessie request timed out.");
      }
      throw new BankOperationError("UNAVAILABLE", "The Nessie request failed before a verifiable response.");
    } finally {
      clearTimeout(timer);
    }
  }
}

function mapStatus(status: string | undefined): PurchaseReceipt["state"] {
  const value = status?.toLowerCase() ?? "";
  if (["completed", "complete", "executed", "settled"].includes(value)) return "COMPLETED";
  if (["pending", "pending_approval", "in_progress"].includes(value)) return "PENDING";
  if (["cancelled", "canceled", "declined", "rejected", "failed"].includes(value)) return "REJECTED";
  return "UNKNOWN";
}

function safeDollars(value: number): number {
  try {
    return dollarsToCents(value);
  } catch {
    throw new BankOperationError("INVALID_RESPONSE", "Nessie returned an invalid money amount.");
  }
}

function requireList(body: unknown): unknown[] {
  if (!Array.isArray(body)) throw new BankOperationError("INVALID_RESPONSE", "Nessie did not return a list.");
  return body;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function accountLikeId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  return stringField(record._id) || stringField(record.customer_id);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function redactSecrets(value: string): string {
  return value.replace(/key=[^&\s]+/gi, "key=redacted").replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer redacted");
}
