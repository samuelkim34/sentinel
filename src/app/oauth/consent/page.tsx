"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../client/api";
import { Button, Card } from "../../../components/ui";

function ConsentPanel() {
  const params = useSearchParams();
  const resource = params.get("resource") ?? "";
  const scope = params.get("scope") ?? "";
  const clientId = params.get("client_id") ?? "";
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const preview = useQuery({
    queryKey: ["oauth-preview", resource],
    queryFn: () => api<{
      matched: boolean;
      approvalAuthority: boolean;
      workspace?: string;
      registration?: string;
      purpose?: string;
      accounts?: string[];
      scopes?: string[];
      proposalsWrite?: boolean;
      note?: string;
    }>(`/api/oauth/preview?resource=${encodeURIComponent(resource)}`),
  });

  async function respond(accept: boolean) {
    setPending(true);
    setError("");
    try {
    const response = await fetch("/api/auth/oauth2/consent", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept, scope, oauth_query: params.toString() }),
    });
    const body = await response.json().catch(() => ({})) as { url?: string; redirect_uri?: string; message?: string };
    const next = body.url ?? body.redirect_uri;
    if (next) {
      window.location.href = next;
      return;
    }
    setError(body.message ?? "Consent could not be recorded.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The server could not be reached."); }
    finally { setPending(false); }
  }

  const data = preview.data;
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Connect a Grok Bot</h1>
      <p className="mt-2">Review this Sentinel connection before allowing the remote MCP client. Consent does not grant approval authority.</p>
      <Card className="mt-4">
        {preview.isLoading ? <p role="status">Loading connection…</p> : null}
        {preview.isError ? <p role="alert">{preview.error.message}</p> : null}
        {data?.matched ? (
          <dl className="grid gap-2">
            <div><dt className="text-sm text-slate-600">Workspace</dt><dd>{data.workspace}</dd></div>
            <div><dt className="text-sm text-slate-600">Registration</dt><dd>{data.registration}</dd></div>
            <div><dt className="text-sm text-slate-600">Purpose</dt><dd>{data.purpose}</dd></div>
            <div><dt className="text-sm text-slate-600">Readable accounts</dt><dd>{data.accounts?.length ? data.accounts.join(", ") : "None granted yet"}</dd></div>
            <div><dt className="text-sm text-slate-600">Proposal permission</dt><dd>{data.proposalsWrite ? "The requested proposal scope can be used under the current mandate. The server checks authority on every call." : "Consent may include the proposal scope, but using it requires an active mandate. Consent never grants spending authority."}</dd></div>
            <div><dt className="text-sm text-slate-600">Approval authority</dt><dd>None. This connection cannot approve or submit a purchase by itself.</dd></div>
          </dl>
        ) : data ? <p>{data.note}</p> : null}
        <p className="mt-3 text-sm">Requested scopes: {scope || "none listed"}. Client: {clientId || "unspecified"}.</p>
      </Card>
      {error ? <p className="mt-3" role="alert">{error}</p> : null}
      <div className="mt-4 flex gap-2">
        <Button type="button" disabled={pending || !data?.matched} onClick={() => void respond(true)}>Allow this connection</Button>
        <Button variant="quiet" type="button" disabled={pending} onClick={() => void respond(false)}>Deny</Button>
      </div>
    </main>
  );
}

export default function ConsentPage() {
  return (
    <Suspense fallback={<p className="p-6" role="status">Loading consent…</p>}>
      <ConsentPanel />
    </Suspense>
  );
}
