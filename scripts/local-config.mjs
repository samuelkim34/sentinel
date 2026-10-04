import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

/** @param {string} [directory] @param {Record<string, string | undefined>} [environment] @returns {Record<string, string>} */
export function readLocalConfig(directory = process.cwd(), environment = process.env) {
  const values = {};
  for (const name of [".env", ".env.local"]) {
    const path = resolve(directory, name);
    if (existsSync(path)) Object.assign(values, parseEnv(readFileSync(path, "utf8")));
  }
  for (const [key, value] of Object.entries(environment)) if (value !== undefined) values[key] = value;
  return values;
}

/** @param {string} [directory] @param {Record<string, string | undefined>} [environment] @returns {Record<string, string>} */
export function ensureLocalConfig(directory = process.cwd(), environment = process.env) {
  const config = readLocalConfig(directory, environment);
  const port = Number(config.PORT || 43117);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  if (!config.BETTER_AUTH_SECRET && existsSync(resolve(directory, config.SENTINEL_DB_PATH || "data/sentinel.sqlite"))) {
    throw new Error("An existing database has no auth secret configured. Restore its original .env.local before starting; Sentinel will not replace your account configuration.");
  }
  const origin = config.APP_ORIGIN || config.BETTER_AUTH_URL || `http://127.0.0.1:${port}`;
  const defaults = {
    APP_ORIGIN: origin,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    ALLOWED_ORIGINS: "",
    ENABLE_MCP_DCR: "false",
    NESSIE_API_KEY: "",
    XAI_API_KEY: "",
    SENTINEL_DB_PATH: "data/sentinel.sqlite",
    NESSIE_BASE_URL: "https://api.nessieisreal.com",
    XAI_AGENT_MODEL: "grok-4.7",
    NESSIE_SIMULATE_COMPLETION: "true",
    NESSIE_WHOLE_DOLLARS_ONLY: "true",
  };
  // Preserve every existing value, including explicit false flags and keys
  // supplied by .env or the process environment. Never copy another user's DB.
  const missing = Object.fromEntries(Object.entries(defaults).filter(([key]) => config[key] === undefined));
  if (Object.keys(missing).length) {
    writeConfigValues(directory, missing);
  }
  return readLocalConfig(directory, environment);
}

export function writeConfigValues(directory, values) {
  const path = resolve(directory, ".env.local");
  let source = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || typeof value !== "string" || /[\r\n]/.test(value)) throw new Error("Invalid local configuration value.");
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*(?:\\r?\\n|$)`, "gm");
    source = source.replace(pattern, "");
    source = source.replace(/\s*$/, "") + `\n${key}=${JSON.stringify(value)}\n`;
  }
  const temporary = `${path}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    writeFileSync(temporary, source, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export function safeStartupMessage(error) {
  let message = error instanceof Error ? error.message : "Unknown startup error.";
  for (const [name, value] of Object.entries(process.env)) {
    if (value && /KEY|SECRET|TOKEN|PASSWORD/i.test(name)) message = message.replaceAll(value, "[redacted]");
  }
  return message;
}
