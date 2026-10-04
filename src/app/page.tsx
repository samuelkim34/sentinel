import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listWorkspaces } from "../domain/workspaces";
import { auth } from "../server/auth/config";
import { getDb } from "../storage/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
        <p className="text-sm font-medium text-blue">Sentinel</p>
        <h1 className="mt-2 text-3xl font-semibold">Decide what a bot may spend.</h1>
        <p className="mt-3 text-base text-slate-700">Create a workspace, connect a Nessie sandbox account, and register the Grok Bot you control. Nothing here is preloaded.</p>
        <div className="mt-6 flex gap-3">
          <Link className="rounded-md bg-blue px-4 py-2 text-white" href="/sign-in">Sign in</Link>
          <Link className="rounded-md border border-line bg-panel px-4 py-2" href="/sign-up">Create account</Link>
        </div>
      </main>
    );
  }
  const workspaces = listWorkspaces(getDb(), session.user.id);
  if (workspaces[0]) redirect(`/w/${workspaces[0].id}`);
  redirect("/onboarding");
}
