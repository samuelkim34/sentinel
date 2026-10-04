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
    <main className="min-h-screen bg-paper px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl overflow-hidden rounded-[32px] border border-line bg-panel auth-shell md:grid-cols-[1.1fr_0.9fr]">
        <section className="flex flex-col justify-between bg-[#111d2b] p-6 text-[#edf3f9] sm:p-8 lg:p-10">
          <div>
            <div className="flex items-center gap-3">
              <span className="brand-mark">S</span>
              <span className="text-[0.72rem] font-medium uppercase tracking-[0.22em] text-slate-300">Sentinel</span>
            </div>
            <p className="mt-12 text-[0.72rem] uppercase tracking-[0.24em] text-slate-300">Create access</p>
            <h1 className="mt-5 max-w-sm font-serif text-4xl leading-none text-white sm:text-5xl">
              Start with a sharper operating model.
            </h1>
          </div>

          <div className="mt-10 space-y-5 border-t border-white/10 pt-6">
            <p className="max-w-md text-sm leading-6 text-slate-300">
              This account gives you access to your workspace and approval flow. It does not create a bank connection or a bot by itself.
            </p>
            <div className="flex items-center gap-3 text-sm text-slate-200">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#dfeaf4]" />
              <span>Purpose-built for operators</span>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-8 lg:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8">
              <p className="text-[0.7rem] uppercase tracking-[0.22em] text-slate-500">Create account</p>
              <h2 className="mt-3 font-serif text-4xl text-ink">Set up your workspace</h2>
            </div>

            <form className="grid gap-5" method="post" onSubmit={async (event) => {
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
              <Field label="Name"><Input name="name" autoComplete="name" placeholder="Alex Morgan" required /></Field>
              <Field label="Email"><Input name="email" type="email" autoComplete="email" placeholder="alex@company.com" required /></Field>
              <Field label="Password"><Input name="password" type="password" autoComplete="new-password" minLength={12} placeholder="At least 12 characters" required /></Field>
              {error ? <p role="alert" className="text-sm text-[#8f2d3b]">{error}</p> : null}
              <Button disabled={pending} type="submit" className="mt-2 w-full">{pending ? "Creating account…" : "Create account"}</Button>
            </form>

            <p className="mt-6 text-sm text-slate-600">
              Already registered? <Link className="font-medium text-ink underline decoration-slate-400 underline-offset-4" href={params.has("sig") || params.get("next")?.startsWith("/invite/") ? `/sign-in?${params.toString()}` : "/sign-in"}>Sign in</Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
