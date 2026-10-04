"use client";

import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatUsd, formatWhen } from "../../../../../client/api";
import { VoicePanel } from "../../../../../components/voice-panel";
import { Button, Card, Field, Textarea } from "../../../../../components/ui";

export default function TaskDetailPage() {
  const { workspaceId, taskId } = useParams<{ workspaceId: string; taskId: string }>();
  const queryClient = useQueryClient();
  const task = useQuery({
    queryKey: ["task", workspaceId, taskId],
    queryFn: () => api<{
      title: string; state: string; kind: string; requestedOutcome: string; registrationId: string; revision: number;
      instructions: Array<{ id: string; state: string; text: string; createdAt: number; acknowledgedAt: number | null; appliedAt: number | null }>;
      updates: Array<{ id: string; phase: string; note: string; source: string; createdAt: number }>;
      proposals: Array<{ id: string; state: string; amountCents: number; explanation: string; decisionCodes: string[] }>;
    }>(`/api/workspaces/${workspaceId}/tasks/${taskId}`),
    refetchInterval: () => (document.hidden ? false : 2000),
  });
  const bot = useQuery({
    queryKey: ["bot-verified", workspaceId, task.data?.registrationId],
    enabled: Boolean(task.data?.registrationId),
    queryFn: () => api<{ toolsVerifiedAt: number | null }>(`/api/workspaces/${workspaceId}/registrations/${task.data!.registrationId}`),
  });
  const instruct = useMutation({
    mutationFn: (text: string) => api(`/api/workspaces/${workspaceId}/tasks/${taskId}/instructions`, { method: "POST", body: JSON.stringify({ text }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", workspaceId, taskId] }),
  });
  if (task.isLoading) return <p role="status">Loading task…</p>;
  if (task.isError) return <p role="alert">{task.error.message}</p>;
  const data = task.data!;
  return (
    <div className="grid gap-4">
      <h1 className="text-3xl font-semibold">{data.title}</h1>
      <p>{data.kind} · {data.state} · revision {data.revision}</p>
      <p>{data.requestedOutcome}</p>
      {data.kind === "PURCHASE" ? <p className="text-sm">Supported money action: one Nessie sandbox merchant purchase. A bot report is not a bank receipt.</p> : <p className="text-sm">Research can describe unsupported requests. Sentinel will not confirm a booking it cannot make.</p>}
      <Card>
        <h2 className="text-xl font-semibold">Instructions</h2>
        {data.instructions.length === 0 ? <p>None queued.</p> : data.instructions.map((item) => <p key={item.id}>{item.state} · {formatWhen(item.createdAt)} · acknowledged {formatWhen(item.acknowledgedAt)} · applied {formatWhen(item.appliedAt)} — {item.text}</p>)}
        <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); instruct.mutate(String(form.get("text"))); }}>
          <Field label="Queue instruction"><Textarea name="text" required rows={3} /></Field>
          <Button type="submit" disabled={instruct.isPending || ['COMPLETED', 'CANCELLED'].includes(data.state)}>Queue instruction</Button>
        </form>
        {instruct.isError && <p role="alert">{instruct.error.message}</p>}
      </Card>
      <Card>
        <h2 className="text-xl font-semibold">Bot reported</h2>
        {data.updates.length === 0 ? <p>No progress reported.</p> : data.updates.map((item) => <p key={item.id}>{item.source}: {item.phase} — {item.note}</p>)}
      </Card>
      <Card>
        <h2 className="text-xl font-semibold">Policy and payment</h2>
        {data.proposals.length === 0 ? <p>No proposal yet.</p> : data.proposals.map((item) => <p key={item.id}>{formatUsd(item.amountCents)} · {item.state} · {item.decisionCodes.join(", ")} — {item.explanation}</p>)}
      </Card>
      <VoicePanel workspaceId={workspaceId} registrationId={data.registrationId} taskId={taskId} toolsVerified={Boolean(bot.data?.toolsVerifiedAt)} />
    </div>
  );
}
