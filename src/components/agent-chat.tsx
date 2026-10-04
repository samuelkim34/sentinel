"use client";
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatUsd, formatWhen } from '../client/api';
import { Badge, Button, Card, Field, Textarea } from './ui';

type History = { messages: Array<{ id: number; role: string; text: string; createdAt: number }>; runs: Array<{ id: string; kind: string; state: string; taskId: string | null; summary: string | null; errorCode: string | null; model: string; tools: Array<{ name: string; error: boolean; createdAt: number }> }>; runtime: { configured: boolean; workerOnline: boolean; model: string } };
type Allowance = { id: string; state: string; expiresAt: number; totalAllowanceCents: number; executionMode: string };
export function AgentChat({ workspaceId, registrationId, active, mandates }: { workspaceId: string; registrationId: string; active: boolean; mandates: Allowance[] }) {
  const queryClient = useQueryClient(); const [message, setMessage] = useState(''); const [mandateId, setMandateId] = useState('');
  const key = ['agent-chat', workspaceId, registrationId];
  const history = useQuery({ queryKey: key, queryFn: () => api<History>(`/api/workspaces/${workspaceId}/agents/${registrationId}/chat`), refetchInterval: 2000 });
  const send = useMutation({ mutationFn: (body: { text: string; mandateId: string | null; requestKey: string }) => api(`/api/workspaces/${workspaceId}/agents/${registrationId}/chat`, { method: 'POST', headers: { 'idempotency-key': body.requestKey }, body: JSON.stringify({ text: body.text, mandateId: body.mandateId }) }), onSuccess: () => { setMessage(''); void queryClient.invalidateQueries({ queryKey: key }); } });
  const retry = useMutation({ mutationFn: (runId: string) => api(`/api/workspaces/${workspaceId}/agents/${registrationId}/retry`, { method: 'POST', body: JSON.stringify({ runId }) }), onSuccess: () => queryClient.invalidateQueries({ queryKey: key }) });
  const busy = history.data?.runs.some(r => r.kind === 'CHAT' && ['QUEUED','RUNNING'].includes(r.state));
  const allowances = mandates.filter(m => m.state === 'ACTIVE' && m.expiresAt > history.dataUpdatedAt);
  return <Card><h2 className="text-xl font-semibold">Chat with your agent</h2>
    <p className="mt-2 text-sm text-slate-600">Ask about recorded work, give a task, or send a new instruction. This conversation is private to your user account; tasks and recorded actions are shared with authorized workspace members.</p>
    {history.isError && <p role="alert">{history.error.message}</p>}
    {history.data && <p className="mt-2 text-sm">Model {history.data.runtime.model} · {history.data.runtime.workerOnline ? 'Agent worker online' : 'Agent worker offline — queued requests wait for it to start'}</p>}
    {history.data && !history.data.runtime.configured && <p className="mt-2 text-sm" role="status">The site operator must set XAI_API_KEY in .env.local and restart Sentinel to enable chat and tasks.</p>}
    <div className="my-4 max-h-96 space-y-3 overflow-auto" aria-live="polite">{history.data?.messages.length === 0 && <p className="text-sm">No conversation yet.</p>}{history.data?.messages.map(m => <div key={m.id} className={`rounded-xl p-3 ${m.role === 'user' ? 'bg-stone-100' : 'border border-line'}`}><p className="text-xs uppercase tracking-widest text-slate-500">{m.role === 'user' ? 'You' : 'Grok agent'} · {formatWhen(m.createdAt)}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{m.text}</p></div>)}</div>
    <form className="grid gap-3" onSubmit={event => { event.preventDefault(); send.mutate({ text: message, mandateId: mandateId || null, requestKey: crypto.randomUUID() }); }}>
      <Field label="Message to agent"><Textarea value={message} onChange={event => setMessage(event.target.value)} required maxLength={4000} rows={3} placeholder="Ask about your accounts or describe one task to start." /></Field>
      <Field label="Purchase permission for this message"><select className="w-full rounded-xl border border-line p-3" value={mandateId} onChange={event => setMandateId(event.target.value)}><option value="">Research and conversation only</option>{allowances.map(m => <option key={m.id} value={m.id}>{formatUsd(m.totalAllowanceCents)} lifetime allowance · {m.executionMode} · {m.id.slice(0, 8)}</option>)}</select></Field>
      {mandateId && <p className="text-sm">This permits the agent to create a purchase task from your message using the selected allowance. Existing limits apply. Auto within limits can submit eligible sandbox purchases without another approval.</p>}
      {send.isError && <p role="alert">{send.error.message}</p>}
      <Button type="submit" disabled={!active || !history.data?.runtime.configured || !message.trim() || send.isPending || busy}>{busy ? 'Agent is working…' : 'Send message'}</Button>
    </form>
    <details className="mt-5" open><summary className="cursor-pointer font-medium">Recent agent runs</summary><div className="mt-3 space-y-3">{history.data?.runs.map(r => <div key={r.id} className="rounded-xl border border-line p-3 text-sm"><div className="flex gap-2"><Badge tone={r.state === 'FAILED' ? 'bad' : r.state === 'SUCCEEDED' ? 'good' : 'neutral'}>{r.state}</Badge><span>{r.kind} · {r.model}</span></div>{r.taskId && <Link className="mt-2 inline-block underline" href={`/w/${workspaceId}/tasks/${r.taskId}`}>Open task</Link>}{r.summary && <p className="mt-2 whitespace-pre-wrap break-words">{r.summary}</p>}{r.errorCode && <p className="mt-1 font-mono text-xs">{r.errorCode}</p>}<p className="mt-2 text-xs text-slate-600">{r.tools.length ? r.tools.map(t => `${t.name}${t.error ? ' (rejected)' : ''}`).join(' → ') : 'No tool calls recorded.'}</p>{r.state === 'FAILED' && <Button className="mt-2" variant="quiet" type="button" disabled={!active || retry.isPending || !history.data?.runtime.configured} onClick={() => retry.mutate(r.id)}>Review done — retry run</Button>}</div>)}</div></details>
    {retry.isError && <p role="alert">{retry.error.message}</p>}
  </Card>;
}
