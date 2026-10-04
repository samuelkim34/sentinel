"use client";

import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

export function followOAuthRedirect(data: unknown): boolean {
  const result = data as { redirect?: boolean; url?: string } | null;
  if (result?.redirect && typeof result.url === "string") { window.location.assign(result.url); return true; }
  return false;
}
