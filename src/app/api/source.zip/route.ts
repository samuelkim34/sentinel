import { getEnv } from "../../../server/env";
import { json } from "../../../server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const repository = getEnv().SOURCE_REPOSITORY_URL.replace(/\/$/, "");
  if (!repository) return json({ error: { code: "SOURCE_REPOSITORY_UNCONFIGURED", message: "Set SOURCE_REPOSITORY_URL after pushing this source to GitHub." } }, 503);
  // GitHub resolves HEAD to the repository's default branch. Runtime files and
  // secrets are never archived by a public endpoint on the application server.
  return Response.redirect(`${repository}/archive/HEAD.zip`, 303);
}
