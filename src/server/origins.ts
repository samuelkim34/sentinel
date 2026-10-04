import { getEnv } from "./env";

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function configuredOrigins(): string[] {
  const env = getEnv();
  const origins = [env.APP_ORIGIN, new URL(env.BETTER_AUTH_URL).origin, ...env.ALLOWED_ORIGINS];
  // Local development commonly switches between these two loopback names.
  // Preserve the configured scheme and port; never trust an arbitrary Host header.
  if (process.env.NODE_ENV !== 'production') {
    const local = new URL(env.APP_ORIGIN);
    if (local.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(local.hostname)) {
      for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
        const alias = new URL(local);
        alias.hostname = hostname;
        origins.push(alias.origin);
      }
    }
  }
  return [...new Set(origins.map(normalizeOrigin).filter((origin): origin is string => origin !== null))];
}

export function isTrustedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  return normalized !== null && configuredOrigins().includes(normalized);
}

export function trustedOriginsFor(): string[] {
  return configuredOrigins();
}
