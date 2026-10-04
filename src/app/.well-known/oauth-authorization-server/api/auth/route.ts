import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "../../../../../server/auth/config";

export const runtime = "nodejs";
export const GET = oauthProviderAuthServerMetadata(auth);
