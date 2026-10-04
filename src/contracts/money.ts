export const MAX_AMOUNT_CENTS = 100_000_000_00;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

export class MoneyError extends Error {
  readonly code = "INVALID_AMOUNT";

  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function parseUsdToCents(input: unknown): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || Object.is(input, -0)) {
      throw new MoneyError("Amount must be a finite non-negative USD value.");
    }
    const raw = input.toString();
    if (/e/i.test(raw)) {
      throw new MoneyError("Exponent notation is not accepted for money.");
    }
    return parseDecimal(raw);
  }
  if (typeof input !== "string") {
    throw new MoneyError("Amount must be a USD decimal string or number.");
  }
  const text = input.trim();
  if (text === "" || /e/i.test(text) || text.includes(",") || text.startsWith("+")) {
    throw new MoneyError("Amount format is not supported.");
  }
  return parseDecimal(text);
}

function parseDecimal(text: string): number {
  const match = DECIMAL.exec(text);
  if (!match) {
    throw new MoneyError("Amount must be a non-negative USD value with at most two decimal places.");
  }
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) {
    throw new MoneyError("Amount exceeds the supported maximum.");
  }
  return cents;
}

export function dollarsToCents(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new MoneyError("Bank amount is not a finite non-negative number.");
  }
  const raw = value.toString();
  if (/e/i.test(raw)) {
    throw new MoneyError("Bank amount used an unsupported magnitude.");
  }
  return parseDecimal(raw);
}

export function centsToDollarNumber(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new MoneyError("Cents value is not a supported integer.");
  }
  const dollars = Math.trunc(cents / 100);
  const frac = cents % 100;
  return Number(`${dollars}.${frac.toString().padStart(2, "0")}`);
}

export function formatUsd(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function sumCents(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new MoneyError("A money total contained an unsafe value.");
    }
    if (total > Number.MAX_SAFE_INTEGER - value) {
      throw new MoneyError("Money total overflowed the supported range.");
    }
    total += value;
  }
  return total;
}
