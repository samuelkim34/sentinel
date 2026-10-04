"use client";

import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatUsd, formatWhen } from "../../../../../client/api";
import { Button, Card, Field, Input } from "../../../../../components/ui";
import { useWorkspace } from "../../../../../client/use-workspace";

export default function AccountDetailPage() {
  const { workspaceId, walletId } = useParams<{ workspaceId: string; walletId: string }>();
  const queryClient = useQueryClient();
  const owner = useWorkspace(workspaceId)?.role === "owner";
  const [password, setPassword] = useState("");
  const [baselineError, setBaselineError] = useState("");
  const account = useQuery({
    queryKey: ["account", workspaceId, walletId],
    queryFn: () => api<Record<string, unknown>>(`/api/workspaces/${workspaceId}/accounts/${walletId}`),
    refetchInterval: () => (document.hidden ? false : 10000),
  });
  const refresh = useMutation({
    mutationFn: () => api(`/api/workspaces/${workspaceId}/accounts/${walletId}/refresh`, { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["account", workspaceId, walletId] }),
  });
  const protect = useMutation({
    mutationFn: async (body: { label: string; amount: string }) => {
      await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
      return api(`/api/workspaces/${workspaceId}/protections`, { method: "POST", body: JSON.stringify({ ...body, walletId }) });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["account", workspaceId, walletId] }),
  });
  const toggle = useMutation({
    mutationFn: async (item: { id: string; version: number; state: string }) => {
      await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
      return api(`/api/workspaces/${workspaceId}/protections/${item.id}`, { method: "PATCH", body: JSON.stringify({ expectedVersion: item.version, state: item.state === "ACTIVE" ? "DISABLED" : "ACTIVE" }) });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["account", workspaceId, walletId] }),
  });
  if (account.isLoading) return <p role="status">Loading account…</p>;
  if (account.isError) return <p role="alert">{account.error.message}</p>;
  const data = account.data as {
    label: string; provider: string; state: string; quarantineReason: string | null; policyBalanceCents: number; observedBalanceCents: number | null;
    protectedCents: number; reservedCents: number; spendableCents: number; lastVerifiedAt: number;
    protections: Array<{ id: string; label: string; amountCents: number; state: string; version: number }>;
    operations: Array<{ proposalId: string; proposalState: string; amountCents: number; upstreamId: string | null }>;
  };
  const shortfall = Math.max(0, data.protectedCents - data.policyBalanceCents);
  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-3xl font-semibold">{data.label}</h1>
        <p>{data.provider} · {data.state}</p>
      </header>
      {data.state === "QUARANTINED" ? <p className="rounded border border-amber-300 bg-amber-50 p-3" role="status">{data.quarantineReason} New submissions are stopped until this is resolved. <button className="underline" type="button" onClick={() => refresh.mutate()}>Refresh observation</button></p> : null}
      <Card>
        <dl className="grid gap-2 font-mono md:grid-cols-3">
          <div><dt>Policy balance</dt><dd>{formatUsd(data.policyBalanceCents)}</dd></div>
          <div><dt>Observed balance</dt><dd>{formatUsd(data.observedBalanceCents)}</dd></div>
          <div><dt>Spendable</dt><dd>{formatUsd(data.spendableCents)}</dd></div>
          <div><dt>Protected</dt><dd>{formatUsd(data.protectedCents)}</dd></div>
          <div><dt>Reserved</dt><dd>{formatUsd(data.reservedCents)}</dd></div>
          <div><dt>Last verified</dt><dd>{formatWhen(data.lastVerifiedAt)}</dd></div>
        </dl>
        {data.observedBalanceCents !== null && data.observedBalanceCents !== data.policyBalanceCents ? <p className="mt-3">The observation and policy balance differ. Sentinel does not treat a posted balance as proof that in-flight work has settled.</p> : null}
        {shortfall > 0 ? <p className="mt-3">Funding shortfall {formatUsd(shortfall)}. New spending is blocked until the balance covers protected funds and reservations.</p> : null}
        <Button className="mt-4" variant="quiet" type="button" onClick={() => refresh.mutate()}>Refresh from Nessie</Button>
        {refresh.isError ? <p role="alert">{refresh.error.message}</p> : null}
        {owner && <form className="mt-4 grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
            await api(`/api/workspaces/${workspaceId}/accounts/${walletId}/baseline`, { method: "POST", body: "{}" });
            queryClient.invalidateQueries({ queryKey: ["account", workspaceId, walletId] });
          })().catch((cause: unknown) => setBaselineError(cause instanceof Error ? cause.message : "Baseline was not saved."));
        }}>
          <p className="text-sm">An owner can copy the latest observation into the policy balance only when no submitted operation is unresolved.</p>
          <Field label="Password for baseline"><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></Field>
          {baselineError ? <p role="alert">{baselineError}</p> : null}
          <Button type="submit" variant="quiet">Set policy baseline from observation</Button>
        </form>}
      </Card>
      <Card>
        <h2 className="text-xl font-semibold">Protected funds</h2>
        {data.protections.length === 0 ? <p className="mt-2">No protections yet.</p> : <ul className="mt-2">{data.protections.map((item) => <li key={item.id}>{item.label}: {formatUsd(item.amountCents)} · {item.state} {owner && <Button type="button" variant="quiet" disabled={!password || toggle.isPending} onClick={() => toggle.mutate(item)}>{item.state === "ACTIVE" ? "Disable" : "Enable"}</Button>}</li>)}</ul>}
        {toggle.isError && <p role="alert">{toggle.error.message}</p>}
        {owner && <form className="mt-4 grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          protect.mutate({ label: String(form.get("label")), amount: String(form.get("amount")) });
        }}>
          <Field label="Label"><Input name="label" required placeholder="Rent" /></Field>
          <Field label="Amount"><Input name="amount" required placeholder="500.00" /></Field>
          <Field label="Confirm password"><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>
          <p className="text-sm">Current reservations: {formatUsd(data.reservedCents)}. Raising the floor cannot undercut an existing hold.</p>
          {protect.isError ? <p role="alert">{protect.error.message}</p> : null}
          <Button type="submit">Save protection</Button>
        </form>}
      </Card>
      <Card>
        <h2 className="text-xl font-semibold">Operations</h2>
        {data.operations.length === 0 ? <p>No Sentinel purchases on this account.</p> : (
          <ul className="mt-2 space-y-2">{data.operations.map((item) => <li key={item.proposalId}>{formatUsd(item.amountCents)} · {item.proposalState} · upstream {item.upstreamId ?? "—"}</li>)}</ul>
        )}
      </Card>
    </div>
  );
}
