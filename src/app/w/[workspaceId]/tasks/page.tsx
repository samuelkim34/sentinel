"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../client/api";
import { Badge, Button, Card, Field, Input, Textarea } from "../../../../components/ui";
import { useState } from "react";

type Task = { id: string; title: string; state: string; kind: string; requestedOutcome: string };

export default function TasksPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  const [selectedBot, setSelectedBot] = useState("");
  const tasks = useQuery({
    queryKey: ["tasks", workspaceId],
    queryFn: () => api<{ tasks: Task[] }>(`/api/workspaces/${workspaceId}/tasks`),
    refetchInterval: () => {
      if (typeof document === "undefined" || document.hidden) return false;
      return 10000;
    },
  });
  const bots = useQuery({ queryKey: ["bots", workspaceId], queryFn: () => api<{ registrations: Array<{ id: string; name: string; state: string }> }>(`/api/workspaces/${workspaceId}/registrations`) });
  const mandates = useQuery({ queryKey: ["mandates", workspaceId], queryFn: () => api<{ mandates: Array<{ id: string; state: string; registrationId: string; expiresAt: number }> }>(`/api/workspaces/${workspaceId}/mandates`) });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/api/workspaces/${workspaceId}/tasks`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] }),
  });
  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.22em] text-slate-500">Tasks</p>
          <h1 className="mt-2 font-serif text-4xl text-ink">Operations queue</h1>
        </div>
        <Badge tone="neutral">{tasks.data?.tasks.length ?? 0} active</Badge>
      </header>

      <p className="max-w-2xl text-sm text-slate-600">A purchase task is one financial intent. Research can describe an unsupported booking, but Sentinel will not show a fake confirmation.</p>
      {tasks.isLoading && <p role="status">Loading tasks…</p>}
      {tasks.isError && <p role="alert">{tasks.error.message}</p>}
      {tasks.data?.tasks.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-[#f8f5f1] p-4 text-sm text-slate-600">No tasks yet.</p> : null}
      {tasks.data?.tasks.map((task) => (
        <Card key={task.id} className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-slate-500">{task.kind}</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">{task.title}</h2>
            </div>
            <Badge tone={task.state === "COMPLETED" ? "good" : task.state === "REJECTED" ? "bad" : "warn"}>{task.state}</Badge>
          </div>
          <p className="mt-3 text-sm text-slate-600">{task.requestedOutcome}</p>
          <Link className="mt-4 inline-block text-sm font-medium text-[#15212d] underline underline-offset-4" href={`/w/${workspaceId}/tasks/${task.id}`}>Open task</Link>
        </Card>
      ))}

      <Card className="p-5">
        <h2 className="text-xl font-semibold text-ink">Create task</h2>
        <form autoComplete="off" className="mt-4 grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          const element = event.currentTarget;
          const form = new FormData(element);
          create.mutate({ title: form.get("title"), requestedOutcome: form.get("requestedOutcome"), kind: form.get("kind"), registrationId: form.get("registrationId"), mandateId: form.get("mandateId") || null }, { onSuccess: () => { element.reset(); setSelectedBot(""); } });
        }}>
          <fieldset disabled={create.isPending} className="contents">
          <Field label="Title"><Input name="title" autoComplete="off" required /></Field>
          <Field label="Desired outcome"><Textarea name="requestedOutcome" autoComplete="off" required rows={3} /></Field>
          <Field label="Kind"><select name="kind" className="w-full rounded-xl border border-line bg-[#f8f4ef] px-3.5 py-2.5 text-base text-ink"><option value="RESEARCH">Research</option><option value="PURCHASE">Purchase</option></select></Field>
          <Field label="Bot"><select name="registrationId" value={selectedBot} onChange={(event) => setSelectedBot(event.target.value)} className="w-full rounded-xl border border-line bg-[#f8f4ef] px-3.5 py-2.5 text-base text-ink" required><option value="">Choose a Bot</option>{(bots.data?.registrations ?? []).filter((bot) => bot.state !== "ARCHIVED").map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></Field>
          <Field label="Mandate for a purchase"><select key={selectedBot} name="mandateId" className="w-full rounded-xl border border-line bg-[#f8f4ef] px-3.5 py-2.5 text-base text-ink"><option value="">None</option>{(mandates.data?.mandates ?? []).filter((item) => item.state === "ACTIVE" && item.registrationId === selectedBot && item.expiresAt > mandates.dataUpdatedAt).map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select></Field>
          {create.isError ? <p role="alert">{create.error.message}</p> : null}
          {create.isSuccess && <p role="status">Task created. The form is ready for another task.</p>}
          <Button type="submit" disabled={create.isPending || !selectedBot}>Create task</Button>
          </fieldset>
        </form>
      </Card>
    </div>
  );
}
