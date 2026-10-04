"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../client/api";
import { Button, Card, Field, Input, Textarea } from "../../../../components/ui";
import { useState } from "react";

type Task = { id: string; title: string; state: string; kind: string; requestedOutcome: string };

export default function TasksPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  const [selectedBot, setSelectedBot] = useState("");
  const tasks = useQuery({ queryKey: ["tasks", workspaceId], queryFn: () => api<{ tasks: Task[] }>(`/api/workspaces/${workspaceId}/tasks`), refetchInterval: () => (document.hidden ? false : 10000) });
  const bots = useQuery({ queryKey: ["bots", workspaceId], queryFn: () => api<{ registrations: Array<{ id: string; name: string; state: string }> }>(`/api/workspaces/${workspaceId}/registrations`) });
  const mandates = useQuery({ queryKey: ["mandates", workspaceId], queryFn: () => api<{ mandates: Array<{ id: string; state: string; registrationId: string; expiresAt: number }> }>(`/api/workspaces/${workspaceId}/mandates`) });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/api/workspaces/${workspaceId}/tasks`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] }),
  });
  return (
    <div className="grid gap-4">
      <h1 className="text-3xl font-semibold">Tasks</h1>
      <p>A purchase task is one financial intent. Research can describe an unsupported booking, but Sentinel will not show a fake confirmation.</p>
      {tasks.isLoading && <p role="status">Loading tasks…</p>}
      {tasks.isError && <p role="alert">{tasks.error.message}</p>}
      {tasks.data?.tasks.length === 0 ? <p>No tasks yet.</p> : null}
      {tasks.data?.tasks.map((task) => <Card key={task.id}><h2 className="text-xl">{task.title}</h2><p>{task.kind} · {task.state}</p><Link className="underline" href={`/w/${workspaceId}/tasks/${task.id}`}>Open task</Link></Card>)}
      <Card>
        <h2 className="text-xl font-semibold">Create task</h2>
        <form className="mt-3 grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          create.mutate({ title: form.get("title"), requestedOutcome: form.get("requestedOutcome"), kind: form.get("kind"), registrationId: form.get("registrationId"), mandateId: form.get("mandateId") || null });
        }}>
          <Field label="Title"><Input name="title" required /></Field>
          <Field label="Desired outcome"><Textarea name="requestedOutcome" required rows={3} /></Field>
          <Field label="Kind"><select name="kind" className="w-full rounded-md border border-line px-3 py-2"><option value="RESEARCH">Research</option><option value="PURCHASE">Purchase</option></select></Field>
          <Field label="Bot"><select name="registrationId" value={selectedBot} onChange={(event) => setSelectedBot(event.target.value)} className="w-full rounded-md border border-line px-3 py-2" required><option value="">Choose a Bot</option>{(bots.data?.registrations ?? []).filter((bot) => bot.state !== "ARCHIVED").map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></Field>
          <Field label="Mandate for a purchase"><select key={selectedBot} name="mandateId" className="w-full rounded-md border border-line px-3 py-2"><option value="">None</option>{(mandates.data?.mandates ?? []).filter((item) => item.state === "ACTIVE" && item.registrationId === selectedBot && item.expiresAt > mandates.dataUpdatedAt).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></Field>
          {create.isError ? <p role="alert">{create.error.message}</p> : null}
          <Button type="submit" disabled={create.isPending || !selectedBot}>Create task</Button>
        </form>
      </Card>
    </div>
  );
}
