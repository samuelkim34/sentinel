"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, formatUsd, formatWhen } from "../../../client/api";
import { Badge, Card } from "../../../components/ui";

type Overview = {
  role: string;
  accounts: Array<{ id: string; label: string; spendableCents: number; protectedCents: number; reservedCents: number; state: string; lastVerifiedAt: number }>;
  registrations: Array<{ id: string; name: string; state: string; toolsVerifiedAt: number | null }>;
  taskCounts: Record<string, number>;
  approvalCount: number;
  events: { events: Array<{ id: number; eventType: string; createdAt: number }> };
  worker: { lastSeenAt: number | null; dueJobs: number };
};

export default function OverviewPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const query = useQuery({
    queryKey: ["overview", workspaceId],
    queryFn: () => api<Overview>(`/api/workspaces/${workspaceId}/overview`),
    refetchInterval: () => (document.hidden ? false : 10000),
  });
  if (query.isLoading) return <p role="status">Loading workspace records…</p>;
  if (query.isError) return <p role="alert">{query.error.message}</p>;
  const data = query.data!;
  const account = data.accounts[0];
  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-3xl font-semibold">Overview</h1>
        <p className="mt-1 text-slate-700">Available funds are Sentinel&apos;s conservative view after protections and reservations. They are not a separate bank account.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-600">Spendable</p>
          <p className="mt-1 font-mono text-2xl">{account ? formatUsd(account.spendableCents) : "No account connected"}</p>
          {account ? <p className="mt-2 text-sm">Protected {formatUsd(account.protectedCents)} · Reserved {formatUsd(account.reservedCents)}</p> : <Link className="mt-3 inline-block underline" href={`/w/${workspaceId}/accounts`}>Connect a Nessie account</Link>}
          {account?.state === "QUARANTINED" ? <p className="mt-2 text-amber-900">This wallet is quarantined. Open the account to reconcile it.</p> : null}
        </Card>
        <Card>
          <p className="text-sm text-slate-600">Bots</p>
          <p className="mt-1 text-2xl">{data.registrations.length}</p>
          {data.registrations.length === 0 ? <Link className="mt-3 inline-block underline" href={`/w/${workspaceId}/bots`}>Register a Grok Bot</Link> : <ul className="mt-2 text-sm">{data.registrations.map((item) => <li key={item.id}>{item.name} · {item.toolsVerifiedAt ? "Tools verified" : item.state}</li>)}</ul>}
        </Card>
        <Card>
          <p className="text-sm text-slate-600">Approvals waiting</p>
          <p className="mt-1 text-2xl">{data.approvalCount}</p>
          <p className="mt-2 text-sm">Worker last seen {formatWhen(data.worker.lastSeenAt)} · {data.worker.dueJobs} due jobs</p>
        </Card>
      </div>
      <Card>
        <h2 className="text-xl font-semibold">Recent activity</h2>
        {data.events.events.length === 0 ? <p className="mt-2">No activity has been recorded in this workspace.</p> : (
          <ul className="mt-3 divide-y divide-line">
            {data.events.events.map((event) => <li key={event.id} className="flex justify-between py-2"><span>{event.eventType}</span><span>{formatWhen(event.createdAt)}</span></li>)}
          </ul>
        )}
      </Card>
      <p className="text-sm text-slate-600">Your role is {data.role}. Task states: {Object.entries(data.taskCounts).map(([state, count]) => `${state} ${count}`).join(", ") || "none yet"}.</p>
      <Badge>Nessie sandbox</Badge>
    </div>
  );
}
