import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { OAUTH_SCOPES } from "../../contracts/constants";
import { getAuthDb } from "../../storage/db";
import { getEnv } from "../env";
import { trustedOriginsFor } from "../origins";

function adminToken(): string {
  return createHash("sha256").update(`resource-admin:${getEnv().BETTER_AUTH_SECRET}`).digest("hex");
}

export function resourceAdminHeaders(source?: Headers): Headers {
  // Resource CRUD also requires the current human session, not just our server key.
  const headers = new Headers(source);
  headers.set("x-sentinel-resource-admin", adminToken());
  return headers;
}

export const authOptions = {
  appName: "Sentinel",
  baseURL: getEnv().BETTER_AUTH_URL,
  secret: getEnv().BETTER_AUTH_SECRET,
  basePath: "/api/auth",
  database: getAuthDb(),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
  },
  trustedOrigins: () => trustedOriginsFor(),
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    freshAge: 60 * 5,
  },
  plugins: [
    jwt({ jwt: { issuer: `${getEnv().BETTER_AUTH_URL.replace(/\/$/, '')}/api/auth` } }),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      scopes: [...OAUTH_SCOPES],
      resources: [],
      // MCP clients are discovered after each per-connection resource is created.
      // User consent, token audience/sub, and live connection checks authorize access.
      enforcePerClientResources: false,
      allowDynamicClientRegistration: getEnv().ENABLE_MCP_DCR,
      allowUnauthenticatedClientRegistration: getEnv().ENABLE_MCP_DCR,
      resourcePrivileges: ({ headers }: { headers: Headers }) => headers.get("x-sentinel-resource-admin") === adminToken(),
    }),
  ],
};

export const auth = betterAuth(authOptions);
