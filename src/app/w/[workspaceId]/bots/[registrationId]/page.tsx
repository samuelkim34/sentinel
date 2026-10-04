"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatUsd, formatWhen } from "../../../../../client/api";
import { VoicePanel } from "../../../../../components/voice-panel";
import { Button, Card, Field, Input, MoneyInput } from "../../../../../components/ui";
import { PasswordConfirmation } from "../../../../../components/password-confirmation";
import { useWorkspace } from "../../../../../client/use-workspace";
import { AgentProfile } from "../../../../../components/agent-profile";
import { AgentChat } from "../../../../../components/agent-chat";
import { CATEGORIES } from "../../../../../contracts/constants";

type Detail = {
  id: string; name: string; purpose: string; state: string; version: number; toolsVerifiedAt: number | null; lastSeenAt: number | null;
  executionMode: string; agentInstructions: string | null; agentReady: boolean;
  controllerUserId: string; grants: Array<{ walletId: string; state: string }>;
  mandates: Array<{ id: string; state: string; expiresAt: number; totalAllowanceCents: number; executionMode: string; perPurchaseLimitCents: number; reviewAboveCents: number }>;
  tasks: Array<{ id: string; title: string; state: string }>;
  setup: { connectorUrl: string; instructions: string; connectionId: string | null; connectionState: string | null };
};

export default function BotDetailPage() {
  const { workspaceId, registrationId } = useParams<{ workspaceId: string; registrationId: string }>();
  const queryClient = useQueryClient();
  const workspace = useWorkspace(workspaceId);
  const session = useQuery({ queryKey: ['current-session'], queryFn: () => api<{ user: { id: string } } | null>('/api/auth/get-session') });
  const [password, setPassword] = useState("");
  const bot = useQuery({
    queryKey: ["bot", workspaceId, registrationId],
    queryFn: () => api<Detail>(`/api/workspaces/${workspaceId}/registrations/${registrationId}`),
    refetchInterval: 10000,
  });
  const accounts = useQuery({ queryKey: ["accounts", workspaceId], queryFn: () => api<{ accounts: Array<{ id: string; label: string }> }>(`/api/workspaces/${workspaceId}/accounts`) });
  const action = useMutation({
    mutationFn: (path: string) => api(`/api/workspaces/${workspaceId}/registrations/${registrationId}/${path}`, { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bot", workspaceId, registrationId] }),
  });
  const mandate = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
      return api(`/api/workspaces/${workspaceId}/mandates`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bot", workspaceId, registrationId] }),
    onSettled: () => setPassword(""),
  });
  const revoke = useMutation({
    mutationFn: (input: { kind: "connections" | "mandates"; id: string }) => api(`/api/workspaces/${workspaceId}/${input.kind}/${input.id}/revoke`, { method: "POST", body: "{}" }),
    onSuccess: (_result, input) => {
      if (input.kind === "connections") queryClient.setQueryData<Detail>(["bot", workspaceId, registrationId], current => current ? { ...current, toolsVerifiedAt: null, agentReady: false, setup: { ...current.setup, connectionId: null, connectionState: "REVOKED" } } : current);
      return queryClient.invalidateQueries({ queryKey: ["bot", workspaceId, registrationId] });
    },
  });
  if (bot.isLoading) return <p role="status">Loading registration…</p>;
  if (bot.isError) return <p role="alert">{bot.error.message}</p>;
  const data = bot.data!;
  const canEdit = workspace?.role === "owner" || session.data?.user.id === data.controllerUserId;
  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-3xl font-semibold">{data.name}</h1>
        <p>{data.purpose}</p>
        <p className="mt-2 text-sm">State {data.state}. {data.executionMode === "ONSITE" ? "Runs in Sentinel." : "External registration."} Last contacted {formatWhen(data.lastSeenAt)}.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="quiet" type="button" disabled={action.isPending || data.state !== "ACTIVE"} onClick={() => action.mutate("pause")}>Pause</Button>
        <Button variant="quiet" type="button" disabled={action.isPending || data.state !== "PAUSED" || !canEdit} onClick={() => action.mutate("resume")}>Resume</Button>
        <Button variant="danger" type="button" disabled={action.isPending || data.state === "ARCHIVED" || !canEdit} onClick={() => action.mutate("archive")}>Archive</Button>
      </div>
      {action.isError ? <p role="alert">{action.error.message}</p> : null}
      {data.executionMode === "EXTERNAL" && <Card>
        <h2 className="text-xl font-semibold">External connection</h2>
        {data.setup.connectionId ? <><p className="mt-2 text-sm">Connection {data.setup.connectionState?.toLowerCase()}. Revoking disconnects the external client.</p><Button className="mt-3" variant="danger" type="button" disabled={!canEdit || revoke.isPending} onClick={() => revoke.mutate({ kind: "connections", id: data.setup.connectionId! })}>Revoke current connection</Button></> : <p className="mt-2 text-sm" role="status">{data.setup.connectionState === "REVOKED" ? "Connection revoked. No external connection is active." : "No external connection is active."}</p>}
      </Card>}
      <AgentProfile workspaceId={workspaceId} data={data} accounts={accounts.data?.accounts ?? []} canEdit={canEdit} canGrant={workspace?.role === "owner" || workspace?.kind === "PERSONAL"} />
      {data.executionMode === "ONSITE" && data.state !== "ARCHIVED" && canEdit && <AgentChat workspaceId={workspaceId} registrationId={registrationId} active={data.agentReady} mandates={data.mandates} />}
      {workspace?.role === "owner" && <Card>
        <h2 className="text-xl font-semibold">New lifetime allowance</h2>
        <p className="text-sm">Granting an allowance does not reserve that money at the bank. A replacement is a new grant, not an edit that resets spending. The default is propose-only.</p>
        <form autoComplete="off" className="mt-3 grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          const element = event.currentTarget;
          const form = new FormData(element);
          const expires = new Date(String(form.get("expires")));
          mandate.mutate({
            registrationId,
            walletId: form.get("walletId"),
            totalAllowance: form.get("allowance"),
            perPurchaseLimit: form.get("perPurchase"),
            reviewAbove: form.get("reviewAbove"),
            allowedCategories: [form.get("category")],
            executionMode: form.get("executionMode"),
            expiresAt: expires.getTime(),
          }, { onSuccess: () => element.reset() });
        }}>
          <fieldset disabled={mandate.isPending} className="contents">
          <Field label="Account">
            <select name="walletId" className="w-full rounded-md border border-line px-3 py-2" required>
              {(accounts.data?.accounts ?? []).map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
            </select>
          </Field>
          <Field label="Lifetime allowance"><MoneyInput name="allowance" required placeholder="200.00" /></Field>
          <Field label="Per-purchase cap"><MoneyInput name="perPurchase" required placeholder="50.00" /></Field>
          <Field label="Review above"><MoneyInput name="reviewAbove" required placeholder="25.00" /></Field>
          <Field label="Category">
            <select name="category" className="w-full rounded-md border border-line px-3 py-2">{CATEGORIES.map(category => <option key={category}>{category}</option>)}</select>
          </Field>
          <Field label="Execution">
            <select name="executionMode" className="w-full rounded-md border border-line px-3 py-2">
              <option value="PROPOSE_ONLY">Propose only — every purchase waits for review</option>
              <option value="AUTO_WITHIN_LIMITS">Auto within limits — eligible purchases can be submitted without another approval</option>
            </select>
          </Field>
          <Field label="Expires"><Input name="expires" type="datetime-local" required /></Field>
          <Field label="Confirm password"><PasswordConfirmation value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>
          {mandate.isError ? <p role="alert">{mandate.error.message}</p> : null}
          {mandate.isSuccess && <p role="status">Lifetime allowance granted.</p>}
          <Button type="submit" disabled={mandate.isPending || !accounts.data?.accounts.length || data.state === "ARCHIVED" || !password}>Grant new allowance</Button>
          </fieldset>
        </form>
        <ul className="mt-4 space-y-2">{data.mandates.map((item) => <li key={item.id}>{item.state} · {formatUsd(item.totalAllowanceCents)} · cap {formatUsd(item.perPurchaseLimitCents)} · {item.executionMode} {item.state === "ACTIVE" && <Button variant="danger" type="button" disabled={revoke.isPending} onClick={() => revoke.mutate({ kind: "mandates", id: item.id })}>Revoke allowance</Button>}</li>)}</ul>
      </Card>}
      {revoke.isError && <p role="alert">{revoke.error.message}</p>}
      <Card>
        <h2 className="text-xl font-semibold">Tasks</h2>
        {data.tasks.length === 0 ? <p>No tasks assigned.</p> : data.tasks.map((task) => <p key={task.id}><Link className="underline" href={`/w/${workspaceId}/tasks/${task.id}`}>{task.title}</Link> · {task.state}</p>)}
      </Card>
      <VoicePanel workspaceId={workspaceId} registrationId={registrationId} agentReady={data.agentReady || Boolean(data.toolsVerifiedAt)} />
    </div>
  );
}
