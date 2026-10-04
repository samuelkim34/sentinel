"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatUsd, formatWhen } from "../../../../client/api";
import { Badge, Button, Card, Field } from "../../../../components/ui";
import { PasswordConfirmation } from "../../../../components/password-confirmation";

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
  payment: { settlementMode: string; state: string; upstreamId: string | null; manualReview: boolean; detail: string | null } | null;
};

export default function ApprovalsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  const proposals = useQuery({
    queryKey: ["proposals", workspaceId],
    queryFn: () => api<{ proposals: Proposal[] }>(`/api/workspaces/${workspaceId}/proposals`),
    refetchInterval: 5000,
  });
  const session = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api<{ workspaces: Array<{ id: string; role: string; kind: string }> }>("/api/workspaces"),
  });
  const role = session.data?.workspaces.find((item) => item.id === workspaceId)?.role ?? "";
  const kind = session.data?.workspaces.find((item) => item.id === workspaceId)?.kind ?? "";
  const decide = useMutation({
    mutationFn: async (input: Decision) => {
      await api("/api/reauth", { method: "POST", body: JSON.stringify({ password: input.password }) });
      return api(`/api/workspaces/${workspaceId}/proposals/${input.id}/${input.action}`, {
        method: "POST",
        body: JSON.stringify({ termsHash: input.termsHash }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposals", workspaceId] }),
  });

  const waiting = (proposals.data?.proposals ?? []).filter((item) => item.state === "REVIEW_REQUIRED");
  const reconcile = useMutation({ mutationFn: (id: string) => api(`/api/workspaces/${workspaceId}/proposals/${id}/reconcile`, { method: "POST", body: "{}" }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proposals", workspaceId] }) });
  const recheck = useMutation({ mutationFn: (item: Proposal) => api<Proposal>(`/api/workspaces/${workspaceId}/proposals/${item.id}/recheck`, { method: 'POST', body: JSON.stringify({ termsHash: item.termsHash }) }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['proposals', workspaceId] }) });
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
          <ApprovalDecision item={item} canDecide={['owner', 'finance'].includes(role)} pending={decide.isPending} onDecide={(input, clear) => decide.mutate(input, { onSettled: clear })} />
        </Card>
      ))}
      {decide.isError ? <p role="alert">{decide.error.message}</p> : null}
      {recheck.isError && <p role="alert">{recheck.error.message}</p>}
      {recheck.isSuccess && <p role="status">Purchase rechecked: {recheck.data.state}. {recheck.data.explanation}</p>}
      {reconcile.isSuccess && <p role="status">Bank status check queued. This does not submit a new payment.</p>}
      {reconcile.isError && <p role="alert">{reconcile.error.message}</p>}

      {rest.length > 0 ? (
        <Card className="p-5">
          <h2 className="text-xl font-semibold text-ink">Other proposals</h2>
          <ul className="mt-3 space-y-3">
            {rest.map((item) => (
              <li key={item.id} className="rounded-xl bg-[#f8f4ef] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink">{formatUsd(item.amountCents)} · {item.merchantLabel}</span>
                  <span className="text-sm text-slate-600">{item.state === "COMPLETED" && item.payment?.settlementMode === "LOCAL_SANDBOX" ? "SANDBOX COMPLETED" : item.state}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{item.payment ? `Payment ${item.payment.state}${item.payment.upstreamId ? ` · ${item.payment.upstreamId}` : ""}` : "No payment created yet"}{item.payment?.manualReview ? " · manual review" : ""}</p>
                {item.payment?.detail && <p role="status" className="mt-2 text-sm">{item.payment.detail}</p>}
                {['owner', 'finance'].includes(role) && item.state === 'BLOCKED' && !item.payment && <div className="mt-3"><p className="text-sm">Refreshes bank data and checks these same purchase terms. Eligible auto-within-limits purchases may proceed.</p><Button className="mt-2" type="button" variant="quiet" disabled={recheck.isPending} onClick={() => recheck.mutate(item)}>{recheck.isPending && recheck.variables?.id === item.id ? 'Refreshing and checking…' : 'Refresh and recheck purchase'}</Button></div>}
                {['owner', 'finance'].includes(role) && ['SUBMITTED_PENDING' , 'RECONCILE_REQUIRED'].includes(item.state) && <Button className="mt-3" variant="quiet" type="button" disabled={reconcile.isPending} onClick={() => reconcile.mutate(item.id)}>Read bank status</Button>}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

type Decision = { id: string; action: "approve" | "reject"; termsHash: string; password: string };

function ApprovalDecision({ item, canDecide, pending, onDecide }: { item: Proposal; canDecide: boolean; pending: boolean; onDecide: (input: Decision, clear: () => void) => void }) {
  const [password, setPassword] = useState("");
  const decide = (action: Decision['action']) => onDecide({ id: item.id, termsHash: item.termsHash, action, password }, () => setPassword(""));
  return <form autoComplete="off" className="mt-4 grid gap-3" method="post" onSubmit={event => event.preventDefault()}>
    <Field label="Confirm password for this decision"><PasswordConfirmation value={password} disabled={pending} onChange={event => setPassword(event.target.value)} /></Field>
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={!canDecide || !password || pending} onClick={() => decide("approve")}>Approve these terms</Button>
      <Button variant="quiet" type="button" disabled={!canDecide || !password || pending} onClick={() => decide("reject")}>Reject</Button>
    </div>
  </form>;
}
