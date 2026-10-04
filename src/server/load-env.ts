import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export function loadEnvFiles(): void {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(/*turbopackIgnore: true*/ process.cwd(), name);
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
