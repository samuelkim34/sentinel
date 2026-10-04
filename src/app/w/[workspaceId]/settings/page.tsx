"use client";

import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatWhen } from "../../../../client/api";
import { Badge, Button, Card, Field } from "../../../../components/ui";
import { PasswordConfirmation } from "../../../../components/password-confirmation";

import { ProductCatalog } from "../../../../components/product-catalog";

const categories = ["GROCERIES", "DINING", "TRANSPORT", "UTILITIES", "OFFICE", "SOFTWARE", "TRAVEL", "HEALTH", "ENTERTAINMENT", "OTHER", "UNKNOWN"];

type Member = { userId: string; name: string; role: string; state: string; version: number };
type Merchant = { id: string; label: string; verifiedCategory: string };

export default function SettingsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  const [inviteUrl, setInviteUrl] = useState("");
  const [password, setPassword] = useState("");
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api<{ workspaces: Array<{ id: string; role: string; kind: string }> }>("/api/workspaces"),
  });
  const current = workspaces.data?.workspaces.find((item) => item.id === workspaceId);
  const overview = useQuery({
    queryKey: ["overview", workspaceId],
    queryFn: () => api<{ worker: { lastSeenAt: number | null; dueJobs: number } }>(`/api/workspaces/${workspaceId}/overview`),
    refetchInterval: 10000,
  });
  const members = useQuery({
    queryKey: ["members", workspaceId],
    enabled: current?.role === "owner" || current?.role === "finance",
    queryFn: () => api<{ members: Member[] }>(`/api/workspaces/${workspaceId}/members`),
  });
  const merchants = useQuery({
    queryKey: ["merchants", workspaceId],
    queryFn: () => api<{ merchants: Merchant[] }>(`/api/workspaces/${workspaceId}/merchants`),
  });
  const prefs = useQuery({
    queryKey: ["prefs"],
    queryFn: () => api<{ retainVoiceTranscripts: boolean }>("/api/preferences"),
  });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api<{ nessieConfigured: boolean; voiceConfigured: boolean; agentsConfigured: boolean; agentModel: string; nessieBaseHost: string; voiceModel: string; bankFreshnessSeconds: number }>("/api/configuration"),
  });
  const invite = useMutation({
    mutationFn: async (role: string) => {
      if (role !== "member") await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
      return api<{ url: string }>(`/api/workspaces/${workspaceId}/invitations`, { method: "POST", body: JSON.stringify({ role }) });
    },
    onSuccess: (result) => setInviteUrl(result.url),
    onSettled: () => setPassword(""),
  });
  const membership = useMutation({
    mutationFn: async (body: { userId: string; role?: string; state?: string; expectedVersion: number }) => {
      if (body.role) await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
      return api(`/api/workspaces/${workspaceId}/members/${body.userId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["members", workspaceId] }),
    onSettled: () => setPassword(""),
  });
  const retention = useMutation({
    mutationFn: (retainVoiceTranscripts: boolean) => api("/api/preferences", { method: "PUT", body: JSON.stringify({ retainVoiceTranscripts }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["prefs"] }),
  });
  const sync = useMutation({
    mutationFn: () => api<{ imported: number }>(`/api/workspaces/${workspaceId}/merchants/sync`, { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["merchants", workspaceId] }),
  });
  const confirm = useMutation({
    mutationFn: (body: { id: string; category: string }) => api(`/api/workspaces/${workspaceId}/merchants/${body.id}`, { method: "PATCH", body: JSON.stringify({ category: body.category }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["merchants", workspaceId] }),
  });

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.22em] text-slate-500">Settings</p>
          <h1 className="mt-2 font-serif text-4xl text-ink">Control plane</h1>
        </div>
        <Badge tone="neutral">{current?.role ?? "member"}</Badge>
      </header>

      {current?.role === "owner" && current.kind === "BUSINESS" && <Field label="Confirm password for adding owner or finance authority"><PasswordConfirmation value={password} onChange={(event) => setPassword(event.target.value)} /></Field>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-[0.7rem] uppercase tracking-[0.14em] text-slate-500">Worker</p>
          <p className="mt-3 text-3xl font-medium text-ink">{overview.data?.worker.dueJobs ?? "—"}</p>
          <p className="mt-2 text-sm text-slate-600">Due jobs in this workspace</p>
          <p className="mt-3 text-sm text-slate-600">Last heartbeat {formatWhen(overview.data?.worker.lastSeenAt)}.</p>
        </Card>
        <Card className="p-5">
          <p className="text-[0.7rem] uppercase tracking-[0.14em] text-slate-500">Voice retention</p>
          <p className="mt-3 text-3xl font-medium text-ink">{prefs.data?.retainVoiceTranscripts ? "On" : "Off"}</p>
          <p className="mt-2 text-sm text-slate-600">Sentinel does not store microphone audio.</p>
        </Card>
        <Card className="p-5">
          <p className="text-[0.7rem] uppercase tracking-[0.14em] text-slate-500">Runtime</p>
          <p className="mt-3 text-lg font-medium text-ink">{config.data?.nessieConfigured ? "Banking ready" : "Banking missing"}</p>
          <p className="mt-2 text-sm text-slate-600">Nessie host: {config.data?.nessieBaseHost ?? "—"}</p>
          <p className="mt-2 text-sm text-slate-600">Grok agents: {config.data?.agentsConfigured ? config.data.agentModel : 'Operator must configure XAI_API_KEY'}</p>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-xl font-semibold text-ink">Voice transcripts</h2>
        <p className="mt-2 text-sm text-slate-600">Retention is off unless you turn it on. Sentinel does not store microphone audio. Turning retention off deletes stored transcript text for your account.</p>
        <p className="mt-3 text-sm text-slate-600">Currently {prefs.data?.retainVoiceTranscripts ? "on" : "off"}.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="quiet" onClick={() => retention.mutate(true)}>Keep transcripts</Button>
          <Button type="button" variant="quiet" onClick={() => retention.mutate(false)}>Delete and stop storing</Button>
        </div>
        {retention.isError ? <p role="alert" className="mt-3">{retention.error.message}</p> : null}
      </Card>

      {current?.role === "owner" && current.kind === "BUSINESS" ? (
        <Card className="p-5">
          <h2 className="text-xl font-semibold text-ink">Invitation</h2>
          <p className="mt-2 text-sm text-slate-600">The link is shown once. It expires in seven days, works for one acceptance, and does not send email.</p>
          <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            invite.mutate(String(form.get("role")));
          }}>
            <Field label="Role">
              <select name="role" className="rounded-xl border border-line bg-[#f8f4ef] px-3.5 py-2.5 text-base text-ink">
                <option value="member">Member</option>
                <option value="finance">Finance</option>
                <option value="owner">Owner</option>
              </select>
            </Field>
            <Button type="submit" disabled={invite.isPending}>Create link</Button>
          </form>
          {inviteUrl ? <p className="mt-4 break-all font-mono text-sm" role="status">{inviteUrl}</p> : null}
          {invite.isError ? <p role="alert" className="mt-3">{invite.error.message}</p> : null}
        </Card>
      ) : null}

      {current?.role === "owner" || current?.role === "finance" ? (
        <Card className="p-5">
          <h2 className="text-xl font-semibold text-ink">People</h2>
          {members.isError ? <p role="alert">{members.error.message}</p> : null}
          <ul className="mt-3 space-y-3">
            {(members.data?.members ?? []).map((member) => (
              <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f8f4ef] p-3">
                <span className="text-sm text-ink">{member.name} · {member.role} · {member.state}</span>
                {current?.role === "owner" ? (
                  <span className="flex flex-wrap gap-2">
                    {member.role !== "owner" ? <Button variant="quiet" type="button" onClick={() => membership.mutate({ userId: member.userId, role: "owner", expectedVersion: member.version })}>Make owner</Button> : null}
                    {member.role !== "finance" ? <Button variant="quiet" type="button" onClick={() => membership.mutate({ userId: member.userId, role: "finance", expectedVersion: member.version })}>Make finance</Button> : null}
                    {member.state === "ACTIVE" ? <Button variant="danger" type="button" onClick={() => membership.mutate({ userId: member.userId, state: "REMOVED", expectedVersion: member.version })}>Remove</Button> : null}
                  </span>
                ) : <span className="text-sm text-slate-600">Finance can review this list. Only an owner changes roles.</span>}
              </li>
            ))}
          </ul>
          {membership.isError ? <p role="alert" className="mt-3">{membership.error.message}</p> : null}
        </Card>
      ) : null}

      <Card className="p-5">
        <h2 className="text-xl font-semibold text-ink">Merchants</h2>
        <p className="mt-2 text-sm text-slate-600">A category of UNKNOWN blocks a category-restricted purchase until an owner confirms it. Sync does not overwrite a category that was already confirmed.</p>
        {current?.role === "owner" && <Button className="mt-4" variant="quiet" type="button" disabled={sync.isPending || !config.data?.nessieConfigured} onClick={() => sync.mutate()}>{sync.isPending ? "Syncing Nessie merchants…" : "Sync Nessie merchants"}</Button>}
        {current?.role === "owner" && config.data && !config.data.nessieConfigured && <p role="status" className="mt-3 text-sm">Set NESSIE_API_KEY on the server and restart Sentinel to sync merchants.</p>}
        {sync.isError ? <p role="alert" className="mt-3">{sync.error.message}</p> : null}
        {sync.isSuccess && <p role="status" className="mt-3 text-sm">{sync.data.imported ? `Sync completed: ${sync.data.imported} merchants imported or updated.` : "Sync completed. Nessie returned no merchants for this API key. Check the merchant data in your Nessie sandbox."}</p>}
        {merchants.isLoading && <p role="status" className="mt-3 text-sm">Loading merchant catalog…</p>}
        {merchants.isError && <p role="alert" className="mt-3">Merchant catalog could not be loaded: {merchants.error.message}</p>}
        {merchants.data?.merchants.length === 0 ? <p className="mt-3 text-sm text-slate-600">No merchants in the catalog yet. Sync imports existing Nessie merchants; it does not create merchants.</p> : (
          <ul className="mt-4 space-y-2">
            {merchants.data?.merchants.map((merchant) => (
              <li key={merchant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f8f4ef] p-3">
                <span className="text-sm text-ink">{merchant.label} · {merchant.verifiedCategory}</span>
                {current?.role === "owner" ? (
                  <select className="rounded-xl border border-line bg-white px-2 py-1.5 text-sm text-ink" defaultValue={merchant.verifiedCategory} onChange={(event) => confirm.mutate({ id: merchant.id, category: event.target.value })}>
                    {categories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {confirm.isError ? <p role="alert" className="mt-3">{confirm.error.message}</p> : null}
      </Card>
      <ProductCatalog workspaceId={workspaceId} />
    </div>
  );
}
