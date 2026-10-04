export class ApiError extends Error {
  constructor(message: string, readonly code = "REQUEST_FAILED") {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as { error?: { message?: string; code?: string } };
  if (!response.ok) throw new ApiError(body.error?.message ?? "The request could not be completed.", body.error?.code);
  return body as T;
}

export function formatUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function formatWhen(value: number | null | undefined, timeZone = "UTC"): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(value);
}
