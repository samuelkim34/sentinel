"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatWhen } from "../../../../client/api";
import { Button, Card, Field, Input, Textarea } from "../../../../components/ui";
import { useWorkspace } from '../../../../client/use-workspace';

type Registration = { id: string; name: string; purpose: string; state: string; executionMode: string; lastSeenAt: number | null };

export default function BotsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  const router = useRouter();
  const workspace = useWorkspace(workspaceId);
  const accounts = useQuery({ queryKey: ['accounts', workspaceId], queryFn: () => api<{ accounts: Array<{ id: string; label: string }> }>(`/api/workspaces/${workspaceId}/accounts`) });
  const bots = useQuery({
    queryKey: ["bots", workspaceId],
    queryFn: () => api<{ registrations: Registration[] }>(`/api/workspaces/${workspaceId}/registrations`),
    refetchInterval: 10000,
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ id: string }>(`/api/workspaces/${workspaceId}/agents`, { method: "POST", headers: { 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) }),
    onSuccess: (agent) => { void queryClient.invalidateQueries({ queryKey: ['bots', workspaceId] }); router.push(`/w/${workspaceId}/bots/${agent.id}`); },
  });
  return (
    <div className="grid gap-4">
      <h1 className="text-3xl font-semibold">Bots</h1>
      <p className="max-w-2xl text-sm text-slate-600">Create, configure and talk to your Grok-powered agents here. Each agent has a purpose, account access and its own tasks. An owner grants spending allowances separately.</p>
      {bots.isLoading ? <p role="status">Loading registrations…</p> : null}
      {bots.isError && <p role="alert">{bots.error.message}</p>}
      {bots.data?.registrations.length === 0 ? <p>No agents yet. Create your first agent below.</p> : null}
      <div className="grid gap-3">
        {bots.data?.registrations.map((bot) => (
          <Card key={bot.id}>
            <h2 className="text-xl font-semibold">{bot.name}</h2>
            <p>{bot.purpose}</p>
            <p className="mt-2 text-sm">{bot.state} · {bot.executionMode === 'ONSITE' ? 'Runs in Sentinel' : 'External registration — enable on-site in setup'} · Last tool access {formatWhen(bot.lastSeenAt)}</p>
            <Link className="mt-2 inline-block underline" href={`/w/${workspaceId}/bots/${bot.id}`}>Open agent</Link>
          </Card>
        ))}
      </div>
      <Card>
        <h2 className="text-xl font-semibold">Create an agent</h2>
        <form className="mt-3 grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          create.mutate({ name: form.get("name"), purpose: form.get("purpose"), instructions: form.get('instructions'), walletIds: form.getAll('walletIds') });
        }}>
          <Field label="Name"><Input name="name" required maxLength={80} /></Field>
          <Field label="Purpose"><Textarea name="purpose" required rows={3} maxLength={500} /></Field>
          <Field label="Instructions"><Textarea name="instructions" maxLength={4000} rows={4} placeholder="Preferences, priorities and how you want the agent to communicate." /></Field>
          <fieldset><legend className="text-sm font-medium">Accounts this agent can read</legend>
            {workspace?.kind === 'BUSINESS' && workspace.role !== 'owner' ? <p className="text-sm">An owner grants business account access after creation.</p> : accounts.data?.accounts.map(account => <label key={account.id} className="mt-2 flex gap-2 text-sm"><input type="checkbox" name="walletIds" value={account.id} />{account.label}</label>)}
            {accounts.data?.accounts.length === 0 && <p className="text-sm">No linked accounts yet. You can add access later.</p>}
          </fieldset>
          {create.isError ? <p role="alert">{create.error.message}</p> : null}
          <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create agent'}</Button>
        </form>
      </Card>
    </div>
  );
}
