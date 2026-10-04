"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authClient, followOAuthRedirect } from "../../client/auth";
import { Button, Field, Input } from "../../components/ui";

export default function SignUpPage() {
  return <Suspense fallback={<p className="p-6" role="status">Loading account creation…</p>}><SignUpForm /></Suspense>;
}

function SignUpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Create your account</h1>
      <p className="mt-2 text-slate-700">This creates a person in Sentinel. It does not create a bot or a bank account.</p>
      <form className="mt-6 grid gap-4" method="post" onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError("");
        const form = new FormData(event.currentTarget);
        try {
        const result = await authClient.signUp.email({
          name: String(form.get("name")),
          email: String(form.get("email")),
          password: String(form.get("password")),
        });
        if (result.error) {
          setError(result.error.message ?? "Account creation failed.");
          return;
        }
        if (followOAuthRedirect(result.data)) return;
        const next = params.get("next");
        router.push(next?.startsWith("/invite/") ? next : "/onboarding");
        router.refresh();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "The server could not be reached."); }
        finally { setPending(false); }
      }}>
        <Field label="Name"><Input name="name" autoComplete="name" required /></Field>
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password"><Input name="password" type="password" autoComplete="new-password" minLength={12} required /></Field>
        {error ? <p role="alert" className="text-rose-800">{error}</p> : null}
        <Button disabled={pending} type="submit">{pending ? "Creating account…" : "Create account"}</Button>
      </form>
      <p className="mt-4 text-sm">Already registered? <Link className="underline" href={params.has("sig") || params.get("next")?.startsWith("/invite/") ? `/sign-in?${params.toString()}` : "/sign-in"}>Sign in</Link></p>
    </main>
  );
}
