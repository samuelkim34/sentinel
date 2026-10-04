"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authClient, followOAuthRedirect } from "../../client/auth";
import { Button, Field, Input } from "../../components/ui";

export default function SignInPage() {
  return (
    <Suspense fallback={<p className="p-6" role="status">Loading sign-in…</p>}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const destination = next?.startsWith("/invite/") || next?.startsWith("/oauth/") ? next : "/";
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Sign in</h1>
      <p className="mt-2 text-slate-700">Use the email and password for your Sentinel account.</p>
      <form className="mt-6 grid gap-4" method="post" onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError("");
        const form = new FormData(event.currentTarget);
        try {
        const result = await authClient.signIn.email({
          email: String(form.get("email")),
          password: String(form.get("password")),
        });
        if (result.error) {
          setError(result.error.code === "INVALID_ORIGIN" ? "This website address is not configured for sign-in. Use the APP_ORIGIN address or add this exact origin to ALLOWED_ORIGINS and restart the server." : result.error.message ?? "Sign-in failed.");
          return;
        }
        if (followOAuthRedirect(result.data)) return;
        router.push(destination);
        router.refresh();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "The server could not be reached."); }
        finally { setPending(false); }
      }}>
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        {error ? <p role="alert" className="text-rose-800">{error}</p> : null}
        <Button disabled={pending} type="submit">{pending ? "Signing in…" : "Sign in"}</Button>
      </form>
      <p className="mt-4 text-sm">No account yet? <Link className="underline" href={params.has('sig') ? `/sign-up?${params.toString()}` : destination.startsWith('/invite/') ? `/sign-up?next=${encodeURIComponent(destination)}` : '/sign-up'}>Create one</Link></p>
    </main>
  );
}
