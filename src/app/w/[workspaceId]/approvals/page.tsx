"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatUsd, formatWhen } from "../../../../client/api";
import { Badge, Button, Card, Field, Input } from "../../../../components/ui";

type Proposal = {
  id: string;
  taskId: string;
  state: string;
  amountCents: number;
  merchantLabel: string;
  reason: string;
  termsHash: string;
  explanation: string;
  decisionCodes: string[];
  requesterUserId: string;
  createdAt: number;
  availableCents: number | null;
  payment: { state: string; upstreamId: string | null; manualReview: boolean } | null;
};

export default function ApprovalsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const proposals = useQuery({
    queryKey: ["proposals", workspaceId],
    queryFn: () => api<{ proposals: Proposal[] }>(`/api/workspaces/${workspaceId}/proposals`),
    refetchInterval: () => (document.hidden ? false : 5000),
  });
  const session = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api<{ workspaces: Array<{ id: string; role: string; kind: string }> }>("/api/workspaces"),
  });
  const role = session.data?.workspaces.find((item) => item.id === workspaceId)?.role ?? "";
  const kind = session.data?.workspaces.find((item) => item.id === workspaceId)?.kind ?? "";
  const decide = useMutation({
    mutationFn: async (input: { id: string; action: "approve" | "reject"; termsHash: string }) => {
      await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
      return api(`/api/workspaces/${workspaceId}/proposals/${input.id}/${input.action}`, {
        method: "POST",
        body: JSON.stringify({ termsHash: input.termsHash }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposals", workspaceId] }),
  });

  const waiting = (proposals.data?.proposals ?? []).filter((item) => item.state === "REVIEW_REQUIRED");
  const reconcile = useMutation({ mutationFn: (id: string) => api(`/api/workspaces/${workspaceId}/proposals/${id}/reconcile`, { method: "POST", body: "{}" }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposals", workspaceId] }) });
  const rest = (proposals.data?.proposals ?? []).filter((item) => item.state !== "REVIEW_REQUIRED");

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.22em] text-slate-500">Approvals</p>
          <h1 className="mt-2 font-serif text-4xl text-ink">Decision log</h1>
        </div>
        <Badge tone={waiting.length > 0 ? "warn" : "good"}>{waiting.length} waiting</Badge>
      </header>

      {kind === "BUSINESS" ? (
        <p className="text-sm text-slate-600">Business rule: the requester, the bot controller, and the person who wrote the task cannot approve that purchase. Ask another owner or a finance member.</p>
      ) : (
        <p className="text-sm text-slate-600">In a personal workspace the owner may approve their own proposal. A member cannot approve.</p>
      )}
      {role === "member" ? <p className="text-sm text-slate-600">Your role can see proposals you requested. It cannot approve them.</p> : null}
      {proposals.isLoading ? <p role="status">Loading proposals…</p> : null}
      {proposals.isError ? <p role="alert">{proposals.error.message}</p> : null}
      {proposals.data && waiting.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-[#f8f5f1] p-4 text-sm text-slate-600">No purchases are waiting for review.</p> : null}

      {waiting.map((item) => (
        <Card key={item.id} className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[0.7rem] uppercase tracking-[0.14em] text-slate-500">Pending review</p>
              <h2 className="mt-2 text-2xl font-semibold text-ink">{formatUsd(item.amountCents)} · {item.merchantLabel}</h2>
            </div>
            <Badge tone="warn">{item.state}</Badge>
          </div>
          <p className="mt-3 text-sm text-slate-700">{item.reason}</p>
          <p className="mt-2 text-sm text-slate-600">{item.explanation}</p>
          <p className="mt-2 font-mono text-xs uppercase tracking-[0.14em] text-slate-500">Terms {item.termsHash.slice(0, 16)}… · codes {item.decisionCodes.join(", ") || "none"} · available {formatUsd(item.availableCents)}</p>
          <p className="mt-3 text-sm text-slate-600">Requested {formatWhen(item.createdAt)}. <Link className="font-medium text-[#15212d] underline underline-offset-4" href={`/w/${workspaceId}/tasks/${item.taskId}`}>Open task</Link></p>
          <form className="mt-4 grid gap-3" method="post" onSubmit={(event) => event.preventDefault()}>
            <Field label="Confirm password for this decision">
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={!['owner', 'finance'].includes(role) || !password || decide.isPending} onClick={() => decide.mutate({ id: item.id, action: "approve", termsHash: item.termsHash })}>Approve these terms</Button>
              <Button variant="quiet" type="button" disabled={!['owner', 'finance'].includes(role) || !password || decide.isPending} onClick={() => decide.mutate({ id: item.id, action: "reject", termsHash: item.termsHash })}>Reject</Button>
            </div>
          </form>
        </Card>
      ))}
      {decide.isError ? <p role="alert">{decide.error.message}</p> : null}
      {reconcile.isError && <p role="alert">{reconcile.error.message}</p>}

      {rest.length > 0 ? (
        <Card className="p-5">
          <h2 className="text-xl font-semibold text-ink">Other proposals</h2>
          <ul className="mt-3 space-y-3">
            {rest.map((item) => (
              <li key={item.id} className="rounded-xl bg-[#f8f4ef] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">{formatUsd(item.amountCents)} · {item.merchantLabel}</span>
                  <span className="text-sm text-slate-600">{item.state}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{item.payment ? `Payment ${item.payment.state}${item.payment.upstreamId ? ` · ${item.payment.upstreamId}` : ""}` : "No payment created yet"}{item.payment?.manualReview ? " · manual review" : ""}</p>
                {['owner', 'finance'].includes(role) && ['SUBMITTED_PENDING', 'RECONCILE_REQUIRED'].includes(item.state) && <Button className="mt-3" variant="quiet" type="button" disabled={reconcile.isPending} onClick={() => reconcile.mutate(item.id)}>Read bank status</Button>}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
