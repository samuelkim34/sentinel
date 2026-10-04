"use client";

import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatUsd, formatWhen } from "../../../../../client/api";
import { Button, Card, Field, Input, MoneyInput } from "../../../../../components/ui";
import { PasswordConfirmation } from "../../../../../components/password-confirmation";
import { useWorkspace } from "../../../../../client/use-workspace";

export default function AccountDetailPage() {
  const { workspaceId, walletId } = useParams<{ workspaceId: string; walletId: string }>();
  const queryClient = useQueryClient();
  const owner = useWorkspace(workspaceId)?.role === "owner";
  const [password, setPassword] = useState("");
  const [baselinePassword, setBaselinePassword] = useState("");
  const account = useQuery({
    queryKey: ["account", workspaceId, walletId],
    queryFn: () => api<Record<string, unknown>>(`/api/workspaces/${workspaceId}/accounts/${walletId}`),
    refetchInterval: 10000,
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
    onSettled: () => setPassword(""),
  });
  const toggle = useMutation({
    mutationFn: async (item: { id: string; version: number; state: string }) => {
      await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
      return api(`/api/workspaces/${workspaceId}/protections/${item.id}`, { method: "PATCH", body: JSON.stringify({ expectedVersion: item.version, state: item.state === "ACTIVE" ? "DISABLED" : "ACTIVE" }) });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["account", workspaceId, walletId] }),
    onSettled: () => setPassword(""),
  });
  const baseline = useMutation({
    mutationFn: async () => {
      await api("/api/reauth", { method: "POST", body: JSON.stringify({ password: baselinePassword }) });
      return api(`/api/workspaces/${workspaceId}/accounts/${walletId}/baseline`, { method: "POST", body: "{}" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["account", workspaceId, walletId] }),
    onSettled: () => setBaselinePassword(""),
  });
  if (account.isLoading) return <p role="status">Loading account…</p>;
  if (account.isError) return <p role="alert">{account.error.message}</p>;
  const data = account.data as {
    localSandboxLedger: boolean; label: string; provider: string; state: string; quarantineReason: string | null; policyBalanceCents: number; observedBalanceCents: number | null;
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
        {data.localSandboxLedger && <p role="status" className="mb-3 text-sm">Local sandbox accounting: completed simulated purchases reduce Sentinel’s spending balance. Nessie’s reported balance is separate and may remain unchanged. This is not real money settlement.</p>}
        <dl className="grid gap-2 font-mono md:grid-cols-3">
          <div><dt>Sentinel spending balance</dt><dd>{formatUsd(data.policyBalanceCents)}</dd></div>
          <div><dt>Nessie reported balance</dt><dd>{formatUsd(data.observedBalanceCents)}</dd></div>
          <div><dt>Spendable</dt><dd>{formatUsd(data.spendableCents)}</dd></div>
          <div><dt>Protected</dt><dd>{formatUsd(data.protectedCents)}</dd></div>
          <div><dt>Reserved</dt><dd>{formatUsd(data.reservedCents)}</dd></div>
          <div><dt>Last verified</dt><dd>{formatWhen(data.lastVerifiedAt)}</dd></div>
        </dl>
        {data.observedBalanceCents !== null && data.observedBalanceCents !== data.policyBalanceCents ? <p className="mt-3">The observation and policy balance differ. Sentinel does not treat a posted balance as proof that in-flight work has settled.</p> : null}
        {shortfall > 0 ? <p className="mt-3">Funding shortfall {formatUsd(shortfall)}. New spending is blocked until the balance covers protected funds and reservations.</p> : null}
        <Button className="mt-4" variant="quiet" type="button" disabled={refresh.isPending} onClick={() => refresh.mutate()}>{refresh.isPending ? "Refreshing from Nessie…" : "Refresh from Nessie"}</Button>
        {refresh.isSuccess && <p role="status" className="mt-2 text-sm">Account refreshed from Nessie at {formatWhen(refresh.submittedAt)}. An unchanged balance is normal. Blocked purchases can be rechecked in Approvals.</p>}
        {refresh.isError ? <p role="alert">{refresh.error.message}</p> : null}
        {owner && !data.localSandboxLedger && <form autoComplete="off" className="mt-4 grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          baseline.mutate();
        }}>
          <p className="text-sm">An owner can copy the latest observation into the policy balance only when no submitted operation is unresolved.</p>
          <Field label="Password for baseline"><PasswordConfirmation value={baselinePassword} onChange={(event) => setBaselinePassword(event.target.value)} required /></Field>
          {baseline.isError ? <p role="alert">{baseline.error.message}</p> : null}
          {baseline.isSuccess && <p role="status">Policy baseline updated.</p>}
          <Button type="submit" variant="quiet" disabled={!baselinePassword || baseline.isPending}>Set policy baseline from observation</Button>
        </form>}
      </Card>
      <Card>
        <h2 className="text-xl font-semibold">Protected funds</h2>
        {data.protections.length === 0 ? <p className="mt-2">No protections yet.</p> : <ul className="mt-2">{data.protections.map((item) => <li key={item.id}>{item.label}: {formatUsd(item.amountCents)} · {item.state} {owner && <Button type="button" variant="quiet" disabled={!password || toggle.isPending} onClick={() => toggle.mutate(item)}>{item.state === "ACTIVE" ? "Disable" : "Enable"}</Button>}</li>)}</ul>}
        {toggle.isError && <p role="alert">{toggle.error.message}</p>}
        {owner && <form autoComplete="off" className="mt-4 grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          const element = event.currentTarget;
          const form = new FormData(element);
          protect.mutate({ label: String(form.get("label")), amount: String(form.get("amount")) }, { onSuccess: () => element.reset() });
        }}>
          <fieldset disabled={protect.isPending || toggle.isPending} className="contents">
          <Field label="Label"><Input name="label" autoComplete="off" required placeholder="Rent" /></Field>
          <Field label="Amount"><MoneyInput name="amount" required placeholder="500.00" /></Field>
          <Field label="Confirm password"><PasswordConfirmation value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>
          <p className="text-sm">Current reservations: {formatUsd(data.reservedCents)}. Raising the floor cannot undercut an existing hold.</p>
          {protect.isError ? <p role="alert">{protect.error.message}</p> : null}
          {protect.isSuccess && <p role="status">Protection saved.</p>}
          <Button type="submit" disabled={!password || protect.isPending || toggle.isPending}>Save protection</Button>
          </fieldset>
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
