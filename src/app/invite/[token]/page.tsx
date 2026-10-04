"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../client/api";
import { Button } from "../../../components/ui";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Workspace invitation</h1>
      <p className="mt-2">Accepting adds you to one business workspace in the role the owner chose. The link works once.</p>
      <Button className="mt-6 w-fit" disabled={pending} type="button" onClick={async () => {
        setPending(true);
        setError("");
        try {
          const result = await api<{ workspaceId: string }>(`/api/invitations/${token}/accept`, { method: "POST", body: "{}" });
          router.push(`/w/${result.workspaceId}`);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "The invitation could not be accepted.";
          setError(message.includes("Sign in") ? "" : message);
          if (cause instanceof Error && message.includes("Sign in")) router.push(`/sign-in?next=/invite/${token}`);
        } finally {
          setPending(false);
        }
      }}>{pending ? "Accepting…" : "Accept invitation"}</Button>
      {error ? <p className="mt-3" role="alert">{error}</p> : null}
      <p className="mt-4 text-sm">Need an account first? <Link className="underline" href={`/sign-up?next=/invite/${token}`}>Create one</Link> or <Link className="underline" href={`/sign-in?next=/invite/${token}`}>sign in</Link>.</p>
    </main>
  );
}
