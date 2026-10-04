"use client";

import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatUsd, formatWhen } from "../../../../../client/api";
import { VoicePanel } from "../../../../../components/voice-panel";
import { Button, Card, Field, Input } from "../../../../../components/ui";
import { useWorkspace } from "../../../../../client/use-workspace";

type Detail = {
  id: string; name: string; purpose: string; state: string; version: number; toolsVerifiedAt: number | null; lastSeenAt: number | null;
  controllerUserId: string; grants: Array<{ walletId: string; state: string }>;
  mandates: Array<{ id: string; state: string; totalAllowanceCents: number; executionMode: string; perPurchaseLimitCents: number; reviewAboveCents: number }>;
  tasks: Array<{ id: string; title: string; state: string }>;
  setup: { connectorUrl: string; instructions: string; connectionId: string | null };
};

export default function BotDetailPage() {
  const { workspaceId, registrationId } = useParams<{ workspaceId: string; registrationId: string }>();
  const queryClient = useQueryClient();
  const workspace = useWorkspace(workspaceId);
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const bot = useQuery({
    queryKey: ["bot", workspaceId, registrationId],
    queryFn: () => api<Detail>(`/api/workspaces/${workspaceId}/registrations/${registrationId}`),
    refetchInterval: () => (document.hidden ? false : 10000),
  });
  const accounts = useQuery({ queryKey: ["accounts", workspaceId], queryFn: () => api<{ accounts: Array<{ id: string; label: string }> }>(`/api/workspaces/${workspaceId}/accounts`) });
  const action = useMutation({
    mutationFn: (path: string) => api(`/api/workspaces/${workspaceId}/registrations/${registrationId}/${path}`, { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bot", workspaceId, registrationId] }),
  });
  const connect = useMutation({
    mutationFn: (mode: string) => api<{ token: string | null; resourceUri: string }>(`/api/workspaces/${workspaceId}/registrations/${registrationId}/connections`, { method: "POST", body: JSON.stringify({ mode }) }),
    onSuccess: (result) => { setToken(result.token); queryClient.invalidateQueries({ queryKey: ["bot", workspaceId, registrationId] }); },
  });
  const mandate = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
      return api(`/api/workspaces/${workspaceId}/mandates`, { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bot", workspaceId, registrationId] }),
  });
  const revoke = useMutation({ mutationFn: (input: { kind: "connections" | "mandates"; id: string }) => api(`/api/workspaces/${workspaceId}/${input.kind}/${input.id}/revoke`, { method: "POST", body: "{}" }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bot", workspaceId, registrationId] }) });
  if (bot.isLoading) return <p role="status">Loading registration…</p>;
  if (bot.isError) return <p role="alert">{bot.error.message}</p>;
  const data = bot.data!;
  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-3xl font-semibold">{data.name}</h1>
        <p>{data.purpose}</p>
        <p className="mt-2 text-sm">State {data.state}. {data.toolsVerifiedAt ? `Tools verified ${formatWhen(data.toolsVerifiedAt)}` : "Not verified by a tool call yet."} Last contacted {formatWhen(data.lastSeenAt)}.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="quiet" type="button" disabled={action.isPending || data.state !== "ACTIVE"} onClick={() => action.mutate("pause")}>Pause</Button>
        <Button variant="quiet" type="button" disabled={action.isPending || data.state !== "PAUSED" || workspace?.role === "finance"} onClick={() => action.mutate("resume")}>Resume</Button>
        <Button variant="danger" type="button" disabled={action.isPending || data.state === "ARCHIVED" || workspace?.role === "finance"} onClick={() => action.mutate("archive")}>Archive</Button>
      </div>
      {action.isError ? <p role="alert">{action.error.message}</p> : null}
      <Card>
        <h2 className="text-xl font-semibold">Native Grok Bot setup</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>Open Grok Bot and choose New in the sidebar.</li>
          <li>Choose Create new Bot and set the name you want.</li>
          <li>Put a short purpose in the profile. Put the longer instructions below in the first message or a saved skill.</li>
          <li>Add a remote HTTPS MCP server using the exact URL and sign in to Sentinel before consenting.</li>
          <li>Ask the bot to call get_context and explain the permissions it received.</li>
          <li>Create a task here, then ask the bot to retrieve it. A routine can check the queue later; it does not create spending authority.</li>
        </ol>
        <p className="mt-3 font-mono text-sm">{data.setup.connectorUrl}</p>
        <pre className="mt-3 whitespace-pre-wrap rounded bg-stone-100 p-3 text-sm">{data.setup.instructions}</pre>
        <div className="mt-3 flex gap-2">
          <Button type="button" disabled={connect.isPending || data.state === "ARCHIVED" || workspace?.role === "finance"} onClick={() => connect.mutate("OAUTH")}>Create OAuth connection</Button>
          {workspace?.kind === "PERSONAL" && <Button variant="quiet" type="button" disabled={connect.isPending || data.state === "ARCHIVED"} onClick={() => connect.mutate("PERSONAL_TOKEN")}>Create personal token</Button>}
          {data.setup.connectionId && <Button variant="danger" type="button" disabled={revoke.isPending} onClick={() => revoke.mutate({ kind: "connections", id: data.setup.connectionId! })}>Revoke current connection</Button>}
        </div>
        {token ? <p className="mt-3" role="status">Personal token, shown once: <span className="font-mono">{token}</span>. This is a credential mode, not OAuth, and it does not prove which bot will use it.</p> : null}
        {connect.isError ? <p role="alert">{connect.error.message}</p> : null}
      </Card>
      {workspace?.role === "owner" && <Card>
        <h2 className="text-xl font-semibold">New lifetime allowance</h2>
        <p className="text-sm">Granting an allowance does not reserve that money at the bank. A replacement is a new grant, not an edit that resets spending. The default is propose-only.</p>
        <form className="mt-3 grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
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
          });
        }}>
          <Field label="Account">
            <select name="walletId" className="w-full rounded-md border border-line px-3 py-2" required>
              {(accounts.data?.accounts ?? []).map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
            </select>
          </Field>
          <Field label="Lifetime allowance"><Input name="allowance" required placeholder="200.00" /></Field>
          <Field label="Per-purchase cap"><Input name="perPurchase" required placeholder="50.00" /></Field>
          <Field label="Review above"><Input name="reviewAbove" required placeholder="25.00" /></Field>
          <Field label="Category">
            <select name="category" className="w-full rounded-md border border-line px-3 py-2"><option>OFFICE</option><option>SOFTWARE</option><option>GROCERIES</option><option>DINING</option><option>TRAVEL</option><option>OTHER</option></select>
          </Field>
          <Field label="Execution">
            <select name="executionMode" className="w-full rounded-md border border-line px-3 py-2">
              <option value="PROPOSE_ONLY">Propose only — every purchase waits for review</option>
              <option value="AUTO_WITHIN_LIMITS">Auto within limits — eligible purchases can be submitted without another approval</option>
            </select>
          </Field>
          <Field label="Expires"><Input name="expires" type="datetime-local" required /></Field>
          <Field label="Confirm password"><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>
          {mandate.isError ? <p role="alert">{mandate.error.message}</p> : null}
          <Button type="submit" disabled={mandate.isPending || !accounts.data?.accounts.length || data.state === "ARCHIVED"}>Grant new allowance</Button>
        </form>
        <ul className="mt-4 space-y-2">{data.mandates.map((item) => <li key={item.id}>{item.state} · {formatUsd(item.totalAllowanceCents)} · cap {formatUsd(item.perPurchaseLimitCents)} · {item.executionMode} {item.state === "ACTIVE" && <Button variant="danger" type="button" disabled={revoke.isPending} onClick={() => revoke.mutate({ kind: "mandates", id: item.id })}>Revoke allowance</Button>}</li>)}</ul>
      </Card>}
      {revoke.isError && <p role="alert">{revoke.error.message}</p>}
      <Card>
        <h2 className="text-xl font-semibold">Tasks</h2>
        {data.tasks.length === 0 ? <p>No tasks assigned.</p> : data.tasks.map((task) => <p key={task.id}>{task.title} · {task.state}</p>)}
      </Card>
      <VoicePanel workspaceId={workspaceId} registrationId={registrationId} toolsVerified={Boolean(data.toolsVerifiedAt)} />
    </div>
  );
}
