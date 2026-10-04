"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatWhen } from "../../../../client/api";
import { Button, Card, Field, Input, Textarea } from "../../../../components/ui";

type Registration = { id: string; name: string; purpose: string; state: string; toolsVerifiedAt: number | null; lastSeenAt: number | null };

export default function BotsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  const bots = useQuery({
    queryKey: ["bots", workspaceId],
    queryFn: () => api<{ registrations: Registration[] }>(`/api/workspaces/${workspaceId}/registrations`),
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/api/workspaces/${workspaceId}/registrations`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bots", workspaceId] }),
  });
  return (
    <div className="grid gap-4">
      <h1 className="text-3xl font-semibold">Bots</h1>
      <p>A registration is Sentinel&apos;s record of a bot you create in Grok. It does not create the native bot, and an empty list is the expected start.</p>
      {bots.isLoading ? <p role="status">Loading registrations…</p> : null}
      {bots.isError && <p role="alert">{bots.error.message}</p>}
      {bots.data?.registrations.length === 0 ? <p>No Grok Bot is registered.</p> : null}
      <div className="grid gap-3">
        {bots.data?.registrations.map((bot) => (
          <Card key={bot.id}>
            <h2 className="text-xl font-semibold">{bot.name}</h2>
            <p>{bot.purpose}</p>
            <p className="mt-2 text-sm">{bot.state} · {bot.toolsVerifiedAt ? `Tools verified ${formatWhen(bot.toolsVerifiedAt)}` : "Waiting for a tool call"} · Last contacted {formatWhen(bot.lastSeenAt)}</p>
            <Link className="mt-2 inline-block underline" href={`/w/${workspaceId}/bots/${bot.id}`}>Open setup</Link>
          </Card>
        ))}
      </div>
      <Card>
        <h2 className="text-xl font-semibold">Register a bot</h2>
        <form className="mt-3 grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          create.mutate({ name: form.get("name"), purpose: form.get("purpose"), walletIds: [] });
        }}>
          <Field label="Name"><Input name="name" required /></Field>
          <Field label="Purpose"><Textarea name="purpose" required rows={3} /></Field>
          {create.isError ? <p role="alert">{create.error.message}</p> : null}
          <Button type="submit" disabled={create.isPending}>Save registration</Button>
        </form>
      </Card>
    </div>
  );
}
