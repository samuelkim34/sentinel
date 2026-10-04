"use client";

import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatWhen } from "../../../../client/api";
import { Button, Card, Field, Input } from "../../../../components/ui";

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
    refetchInterval: () => (document.hidden ? false : 10000),
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
    queryFn: () => api<{ nessieConfigured: boolean; voiceConfigured: boolean; nessieBaseHost: string; voiceModel: string; bankFreshnessSeconds: number }>("/api/configuration"),
  });
  const invite = useMutation({
    mutationFn: async (role: string) => {
      if (role !== "member") await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
      return api<{ url: string }>(`/api/workspaces/${workspaceId}/invitations`, { method: "POST", body: JSON.stringify({ role }) });
    },
    onSuccess: (result) => setInviteUrl(result.url),
  });
  const membership = useMutation({
    mutationFn: async (body: { userId: string; role?: string; state?: string; expectedVersion: number }) => {
      if (body.role) await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
      return api(`/api/workspaces/${workspaceId}/members/${body.userId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["members", workspaceId] }),
  });
  const retention = useMutation({
    mutationFn: (retainVoiceTranscripts: boolean) => api("/api/preferences", { method: "PUT", body: JSON.stringify({ retainVoiceTranscripts }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["prefs"] }),
  });
  const sync = useMutation({
    mutationFn: () => api(`/api/workspaces/${workspaceId}/merchants/sync`, { method: "POST", body: "{}" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["merchants", workspaceId] }),
  });
  const confirm = useMutation({
    mutationFn: (body: { id: string; category: string }) => api(`/api/workspaces/${workspaceId}/merchants/${body.id}`, { method: "PATCH", body: JSON.stringify({ category: body.category }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["merchants", workspaceId] }),
  });

  return (
    <div className="grid gap-4">
      <h1 className="text-3xl font-semibold">Settings</h1>
      {current?.role === "owner" && current.kind === "BUSINESS" && <Field label="Confirm password for adding owner or finance authority"><Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>}
      <Card>
        <h2 className="text-xl font-semibold">Worker</h2>
        <p className="mt-2">Last heartbeat {formatWhen(overview.data?.worker.lastSeenAt)}. Due jobs in this workspace: {overview.data?.worker.dueJobs ?? "—"}.</p>
        <p className="mt-1 text-sm">If the heartbeat is old, payment jobs stay queued. The web process does not submit purchases itself.</p>
      </Card>
      <Card>
        <h2 className="text-xl font-semibold">Voice transcripts</h2>
        <p className="mt-2 text-sm">Retention is off unless you turn it on. Sentinel does not store microphone audio. Turning retention off deletes stored transcript text for your account.</p>
        <p className="mt-2">Currently {prefs.data?.retainVoiceTranscripts ? "on" : "off"}.</p>
        <div className="mt-3 flex gap-2">
          <Button type="button" variant="quiet" onClick={() => retention.mutate(true)}>Keep transcripts</Button>
          <Button type="button" variant="quiet" onClick={() => retention.mutate(false)}>Delete and stop storing</Button>
        </div>
        {retention.isError ? <p role="alert">{retention.error.message}</p> : null}
      </Card>
      <Card>
        <h2 className="text-xl font-semibold">Runtime</h2>
        <ul className="mt-2 text-sm">
          <li>Nessie host: {config.data?.nessieBaseHost ?? "—"} ({config.data?.nessieConfigured ? "key present" : "key missing"})</li>
          <li>Voice model: {config.data?.voiceModel ?? "—"} ({config.data?.voiceConfigured ? "key present" : "key missing"})</li>
          <li>Bank freshness window: {config.data?.bankFreshnessSeconds ?? "—"} seconds</li>
        </ul>
      </Card>
      {current?.role === "owner" && current.kind === "BUSINESS" ? (
        <Card>
          <h2 className="text-xl font-semibold">Invitation</h2>
          <p className="mt-2 text-sm">The link is shown once. It expires in seven days, works for one acceptance, and does not send email.</p>
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            invite.mutate(String(form.get("role")));
          }}>
            <Field label="Role">
              <select name="role" className="rounded-md border border-line bg-panel px-3 py-2">
                <option value="member">Member</option>
                <option value="finance">Finance</option>
                <option value="owner">Owner</option>
              </select>
            </Field>
            <Button type="submit" disabled={invite.isPending}>Create link</Button>
          </form>
          {inviteUrl ? <p className="mt-3 break-all font-mono text-sm" role="status">{inviteUrl}</p> : null}
          {invite.isError ? <p role="alert">{invite.error.message}</p> : null}
        </Card>
      ) : null}
      {current?.role === "owner" || current?.role === "finance" ? (
        <Card>
          <h2 className="text-xl font-semibold">People</h2>
          {members.isError ? <p role="alert">{members.error.message}</p> : null}
          <ul className="mt-2 space-y-3">
            {(members.data?.members ?? []).map((member) => (
              <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2">
                <span>{member.name} · {member.role} · {member.state}</span>
                {current?.role === "owner" ? (
                  <span className="flex gap-2">
                    {member.role !== "owner" ? <Button variant="quiet" type="button" onClick={() => membership.mutate({ userId: member.userId, role: "owner", expectedVersion: member.version })}>Make owner</Button> : null}
                    {member.role !== "finance" ? <Button variant="quiet" type="button" onClick={() => membership.mutate({ userId: member.userId, role: "finance", expectedVersion: member.version })}>Make finance</Button> : null}
                    {member.state === "ACTIVE" ? <Button variant="danger" type="button" onClick={() => membership.mutate({ userId: member.userId, state: "REMOVED", expectedVersion: member.version })}>Remove</Button> : null}
                  </span>
                ) : <span className="text-sm">Finance can review this list. Only an owner changes roles.</span>}
              </li>
            ))}
          </ul>
          {membership.isError ? <p role="alert">{membership.error.message}</p> : null}
        </Card>
      ) : null}
      <Card>
        <h2 className="text-xl font-semibold">Merchants</h2>
        <p className="mt-2 text-sm">A category of UNKNOWN blocks a category-restricted purchase until an owner confirms it. Sync does not overwrite a category that was already confirmed.</p>
        {current?.role === "owner" && <Button className="mt-3" variant="quiet" type="button" disabled={sync.isPending} onClick={() => sync.mutate()}>Sync Nessie merchants</Button>}
        {sync.isError ? <p role="alert">{sync.error.message}</p> : null}
        {(merchants.data?.merchants ?? []).length === 0 ? <p className="mt-3">No merchants in the catalog.</p> : (
          <ul className="mt-3 space-y-2">
            {merchants.data?.merchants.map((merchant) => (
              <li key={merchant.id} className="flex flex-wrap items-center gap-2">
                <span>{merchant.label} · {merchant.verifiedCategory}</span>
                {current?.role === "owner" ? (
                  <select className="rounded-md border border-line px-2 py-1" defaultValue={merchant.verifiedCategory} onChange={(event) => confirm.mutate({ id: merchant.id, category: event.target.value })}>
                    {categories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {confirm.isError ? <p role="alert">{confirm.error.message}</p> : null}
      </Card>
    </div>
  );
}
