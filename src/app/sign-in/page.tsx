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
    <main className="min-h-screen bg-paper px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl overflow-hidden rounded-[32px] border border-line bg-panel auth-shell md:grid-cols-[1.1fr_0.9fr]">
        <section className="flex flex-col justify-between bg-[#111d2b] p-6 text-[#edf3f9] sm:p-8 lg:p-10">
          <div>
            <div className="flex items-center gap-3">
              <span className="brand-mark">S</span>
              <span className="text-[0.72rem] font-medium uppercase tracking-[0.22em] text-slate-300">Sentinel</span>
            </div>
            <p className="mt-12 text-[0.72rem] uppercase tracking-[0.24em] text-slate-300">Operational clarity</p>
            <h1 className="mt-5 max-w-sm font-serif text-4xl leading-none text-white sm:text-5xl">
              Financial control, without the noise.
            </h1>
          </div>

          <div className="mt-10 space-y-5 border-t border-white/10 pt-6">
            <p className="max-w-md text-sm leading-6 text-slate-300">
              Coordinate spend, approvals, and workspace activity from one restrained operating layer built for people who move money carefully.
            </p>
            <div className="flex items-center gap-3 text-sm text-slate-200">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#dfeaf4]" />
              <span>Real-time workspace visibility</span>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-8 lg:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8">
              <p className="text-[0.7rem] uppercase tracking-[0.22em] text-slate-500">Access</p>
              <h2 className="mt-3 font-serif text-4xl text-ink">Welcome back</h2>
            </div>

            <form className="grid gap-5" method="post" onSubmit={async (event) => {
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
              <Field label="Email"><Input name="email" type="email" autoComplete="email" placeholder="you@company.com" required /></Field>
              <Field label="Password"><Input name="password" type="password" autoComplete="current-password" placeholder="••••••••••••" required /></Field>
              {error ? <p role="alert" className="text-sm text-[#8f2d3b]">{error}</p> : null}
              <Button disabled={pending} type="submit" className="mt-2 w-full">{pending ? "Signing in…" : "Sign in"}</Button>
            </form>

            <p className="mt-6 text-sm text-slate-600">
              No account yet? <Link className="font-medium text-ink underline decoration-slate-400 underline-offset-4" href={params.has('sig') ? `/sign-up?${params.toString()}` : destination.startsWith('/invite/') ? `/sign-up?next=${encodeURIComponent(destination)}` : '/sign-up'}>Create one</Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
