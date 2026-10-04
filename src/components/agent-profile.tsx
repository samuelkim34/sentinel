"use client";
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client/api';
import { Button, Card, Field, Input, Textarea } from './ui';

export type AgentProfileData = { id: string; name: string; purpose: string; version: number; state: string; executionMode: string; agentInstructions: string | null; grants: Array<{ walletId: string; state: string }> };
export function AgentProfile({ workspaceId, data, accounts, canEdit, canGrant }: { workspaceId: string; data: AgentProfileData; accounts: Array<{ id: string; label: string }>; canEdit: boolean; canGrant: boolean }) {
  const queryClient = useQueryClient();
  const save = useMutation({ mutationFn: (body: Record<string, unknown>) => api(`/api/workspaces/${workspaceId}/agents/${data.id}`, { method: 'PATCH', body: JSON.stringify(body) }), onSuccess: () => queryClient.invalidateQueries() });
  const enable = useMutation({ mutationFn: () => api(`/api/workspaces/${workspaceId}/agents/${data.id}/enable`, { method: 'POST', body: JSON.stringify({ instructions: '' }) }), onSuccess: () => queryClient.invalidateQueries() });
  if (data.executionMode !== 'ONSITE') return <Card><h2 className="text-xl font-semibold">Enable this agent on-site</h2><p className="mt-2 text-sm">Keep this registration’s name, allowances and tasks, and run it using Grok inside Sentinel. Enabling it revokes its external connections. Finish or cancel existing external work first.</p><Button className="mt-3" type="button" disabled={!canEdit || enable.isPending || data.state === 'ARCHIVED'} onClick={() => enable.mutate()}>Enable on-site agent</Button>{enable.isError && <p role="alert">{enable.error.message}</p>}</Card>;
  return <Card><h2 className="text-xl font-semibold">Agent configuration</h2><p className="mt-2 text-sm text-slate-600">Grok follows these preferences within the account permissions and spending rules you grant.</p>
    <form key={`${data.version}:${data.grants.filter(g => g.state === 'ACTIVE').map(g => g.walletId).join(',')}`} className="mt-3 grid gap-3" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); save.mutate({ name: form.get('name'), purpose: form.get('purpose'), instructions: form.get('instructions'), walletIds: canGrant ? form.getAll('walletIds') : data.grants.filter(g => g.state === 'ACTIVE').map(g => g.walletId), expectedVersion: data.version }); }}>
      <Field label="Agent name"><Input name="name" defaultValue={data.name} required maxLength={80} disabled={!canEdit} /></Field>
      <Field label="Agent purpose"><Textarea name="purpose" defaultValue={data.purpose} required maxLength={500} rows={2} disabled={!canEdit} /></Field>
      <Field label="Agent instructions"><Textarea name="instructions" defaultValue={data.agentInstructions ?? ''} maxLength={4000} rows={4} disabled={!canEdit} /></Field>
      <fieldset disabled={!canEdit || !canGrant}><legend className="text-sm font-medium">Account read access</legend>{accounts.map(account => <label key={account.id} className="mt-2 flex gap-2 text-sm"><input type="checkbox" name="walletIds" value={account.id} defaultChecked={data.grants.some(g => g.walletId === account.id && g.state === 'ACTIVE')} />{account.label}</label>)}</fieldset>
      {!canGrant && <p className="text-sm">An owner manages business account access.</p>}
      {save.isError && <p role="alert">{save.error.message}</p>}{save.isSuccess && <p role="status">Agent configuration saved.</p>}
      <Button type="submit" disabled={!canEdit || save.isPending || data.state === 'ARCHIVED'}>Save agent configuration</Button>
    </form>
  </Card>;
}
