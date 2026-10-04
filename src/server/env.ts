import { z } from "zod";

const schema = z.object({
  APP_ORIGIN: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  ENABLE_MCP_DCR: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SOURCE_REPOSITORY_URL: z.string().default('').refine((value) => !value || /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(value), 'Use the HTTPS GitHub repository URL.'),
  ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean))
    .pipe(z.array(z.string().url())),
  SENTINEL_DB_PATH: z.string().min(1),
  NESSIE_API_KEY: z.string().min(1).optional(),
  NESSIE_BASE_URL: z.string().url().default("https://api.nessieisreal.com"),
  XAI_API_KEY: z.string().min(1).optional(),
  XAI_VOICE_MODEL: z.string().min(1).default("grok-voice-latest"),
  BANK_FRESHNESS_SECONDS: z.coerce.number().int().positive().default(60),
  TASK_LEASE_SECONDS: z.coerce.number().int().positive().default(300),
  VOICE_SESSION_SECONDS: z.coerce.number().int().positive().default(900),
  VOICE_EPHEMERAL_SECONDS: z.coerce.number().int().positive().default(300),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
  RECONCILE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse({
    APP_ORIGIN: process.env.APP_ORIGIN,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    ENABLE_MCP_DCR: process.env.ENABLE_MCP_DCR || undefined,
    SOURCE_REPOSITORY_URL: process.env.SOURCE_REPOSITORY_URL || undefined,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || undefined,
    SENTINEL_DB_PATH: process.env.SENTINEL_DB_PATH,
    NESSIE_API_KEY: process.env.NESSIE_API_KEY || undefined,
    NESSIE_BASE_URL: process.env.NESSIE_BASE_URL || undefined,
    XAI_API_KEY: process.env.XAI_API_KEY || undefined,
    XAI_VOICE_MODEL: process.env.XAI_VOICE_MODEL || undefined,
    BANK_FRESHNESS_SECONDS: process.env.BANK_FRESHNESS_SECONDS || undefined,
    TASK_LEASE_SECONDS: process.env.TASK_LEASE_SECONDS || undefined,
    VOICE_SESSION_SECONDS: process.env.VOICE_SESSION_SECONDS || undefined,
    VOICE_EPHEMERAL_SECONDS: process.env.VOICE_EPHEMERAL_SECONDS || undefined,
    WORKER_POLL_MS: process.env.WORKER_POLL_MS || undefined,
    RECONCILE_MAX_ATTEMPTS: process.env.RECONCILE_MAX_ATTEMPTS || undefined,
  });
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "env").join(", ");
    throw new Error(`Sentinel environment is incomplete or invalid: ${fields}`);
  }
  assertBankUrl(parsed.data.NESSIE_BASE_URL);
  const app = new URL(parsed.data.APP_ORIGIN);
  const auth = new URL(parsed.data.BETTER_AUTH_URL);
  for (const url of [app, auth, ...parsed.data.ALLOWED_ORIGINS.map((value) => new URL(value))]) {
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
      throw new Error('APP_ORIGIN, BETTER_AUTH_URL and ALLOWED_ORIGINS must be complete HTTP(S) origins without paths or credentials.');
    }
  }
  if (app.origin !== auth.origin) throw new Error('APP_ORIGIN and BETTER_AUTH_URL must use the same canonical origin.');
  if (process.env.NODE_ENV === 'production' && app.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(app.hostname)) {
    throw new Error('Production APP_ORIGIN must use HTTPS.');
  }
  parsed.data.APP_ORIGIN = app.origin;
  parsed.data.BETTER_AUTH_URL = auth.origin;
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}

function assertBankUrl(value: string): void {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const allowedHttp = host === "api.nessieisreal.com" || host === "localhost" || host === "127.0.0.1";
  if (url.protocol === "http:" && allowedHttp) return;
  if (url.protocol === "https:") return;
  throw new Error("NESSIE_BASE_URL must be https, or the documented Nessie HTTP host.");
}

export function publicConfig() {
  const env = getEnv();
  return {
    nessieConfigured: Boolean(env.NESSIE_API_KEY),
    voiceConfigured: Boolean(env.XAI_API_KEY),
    nessieBaseHost: new URL(env.NESSIE_BASE_URL).host,
    voiceModel: env.XAI_VOICE_MODEL,
    bankFreshnessSeconds: env.BANK_FRESHNESS_SECONDS,
    taskLeaseSeconds: env.TASK_LEASE_SECONDS,
    voiceSessionSeconds: env.VOICE_SESSION_SECONDS,
    appOrigin: env.APP_ORIGIN,
    mcpDynamicRegistrationEnabled: env.ENABLE_MCP_DCR,
  };
}
