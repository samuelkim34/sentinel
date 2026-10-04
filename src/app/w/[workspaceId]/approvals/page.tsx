"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatUsd, formatWhen } from "../../../../client/api";
import { Button, Card, Field, Input } from "../../../../components/ui";

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
    <div className="grid gap-4">
      <header>
        <h1 className="text-3xl font-semibold">Approvals</h1>
        <p className="mt-1">An approval records the exact terms hash. It cannot raise a limit, ignore protected funds, or approve a purchase you requested in a business workspace.</p>
      </header>
      {kind === "BUSINESS" ? (
        <p className="text-sm">Business rule: the requester, the bot controller, and the person who wrote the task cannot approve that purchase. Ask another owner or a finance member.</p>
      ) : (
        <p className="text-sm">In a personal workspace the owner may approve their own proposal. A member cannot approve.</p>
      )}
      {role === "member" ? <p>Your role can see proposals you requested. It cannot approve them.</p> : null}
      {proposals.isLoading ? <p role="status">Loading proposals…</p> : null}
      {proposals.isError ? <p role="alert">{proposals.error.message}</p> : null}
      {proposals.data && waiting.length === 0 ? <p>No purchases are waiting for review.</p> : null}
      {waiting.map((item) => (
        <Card key={item.id}>
          <h2 className="text-xl font-semibold">{formatUsd(item.amountCents)} · {item.merchantLabel}</h2>
          <p className="mt-1">{item.reason}</p>
          <p className="mt-2 text-sm">{item.explanation}</p>
          <p className="mt-2 font-mono text-sm">Terms {item.termsHash.slice(0, 16)}… · codes {item.decisionCodes.join(", ") || "none"} · available {formatUsd(item.availableCents)}</p>
          <p className="text-sm">Requested {formatWhen(item.createdAt)}. <Link className="underline" href={`/w/${workspaceId}/tasks/${item.taskId}`}>Open task</Link></p>
          <form className="mt-3 grid gap-3" method="post" onSubmit={(event) => event.preventDefault()}>
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
        <Card>
          <h2 className="text-xl font-semibold">Other proposals</h2>
          <ul className="mt-2 space-y-2">
            {rest.map((item) => (
              <li key={item.id}>
                {formatUsd(item.amountCents)} · {item.state} · {item.merchantLabel}
                {item.payment ? ` · payment ${item.payment.state}${item.payment.upstreamId ? ` · ${item.payment.upstreamId}` : ""}` : ""}
                {item.payment?.manualReview ? " · manual review" : ""}
                {['owner', 'finance'].includes(role) && ['SUBMITTED_PENDING', 'RECONCILE_REQUIRED'].includes(item.state) && <Button variant="quiet" type="button" disabled={reconcile.isPending} onClick={() => reconcile.mutate(item.id)}>Read bank status</Button>}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
