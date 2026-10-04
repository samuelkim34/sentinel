"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, formatUsd } from "../../../client/api";
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

const eventLabels: Record<string, string> = {
  BANK_OBSERVED: "Bank balance updated",
  INSTRUCTION_QUEUED: "Task queued",
  PROTECTION_CHANGED: "Protection changed",
  ACCOUNT_LINKED: "Account linked",
  TASK_COMPLETED: "Task completed",
  APPROVAL_REQUIRED: "Approval required",
  POLICY_UPDATED: "Policy updated",
};

function formatRelativeTime(value: number): string {
  const deltaMinutes = Math.max(0, Math.round((Date.now() - value) / 60000));
  if (deltaMinutes < 1) return "just now";
  if (deltaMinutes < 60) return `${deltaMinutes} min ago`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours} hr ago`;
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays} day${deltaDays === 1 ? "" : "s"} ago`;
}

export default function OverviewPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const query = useQuery({
    queryKey: ["overview", workspaceId],
    queryFn: () => api<Overview>(`/api/workspaces/${workspaceId}/overview`),
    refetchInterval: () => {
      if (typeof document === "undefined" || document.hidden) return false;
      return 10000;
    },
  });
  if (query.isLoading) return <p role="status">Loading workspace records…</p>;
  if (query.isError) return <p role="alert">{query.error.message}</p>;
  const data = query.data!;
  const account = data.accounts[0];
  const spendable = account?.spendableCents ?? 0;
  const protectedAmount = account?.protectedCents ?? 0;
  const reservedAmount = account?.reservedCents ?? 0;
  const totalBalance = spendable + protectedAmount + reservedAmount;

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.22em] text-slate-500">Overview</p>
          <h1 className="mt-2 font-serif text-4xl text-ink sm:text-5xl">{account ? `Your agents can safely spend ${formatUsd(spendable)}` : "Connect a bank account"}</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link className="inline-flex items-center justify-center rounded-full border border-line bg-panel px-4 py-2.5 text-sm font-medium text-ink hover:bg-[#f2eee7]" href={`/w/${workspaceId}/tasks`}>New task</Link>
          <Link className="inline-flex items-center justify-center rounded-full bg-[#15212d] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1d2d3d]" href={`/w/${workspaceId}/accounts`}>Create spending rule</Link>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <Card className="overflow-hidden border-none bg-[#111d2b] p-0 text-[#edf3f9] shadow-none">
          <div className="p-6 sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[0.7rem] uppercase tracking-[0.22em] text-slate-300">Available to spend</p>
              <Badge tone="good">{account?.state === "QUARANTINED" ? "Quarantined" : "Protected"}</Badge>
            </div>
            <p className="mt-5 font-serif text-4xl sm:text-5xl">{account ? formatUsd(spendable) : "No account connected"}</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-[0.7rem] uppercase tracking-[0.16em] text-slate-300">Balance</p>
                <p className="mt-2 text-lg font-medium text-white">{account ? formatUsd(totalBalance) : "—"}</p>
              </div>
              <div>
                <p className="text-[0.7rem] uppercase tracking-[0.16em] text-slate-300">Protected</p>
                <p className="mt-2 text-lg font-medium text-white">{account ? formatUsd(protectedAmount) : "—"}</p>
              </div>
              <div>
                <p className="text-[0.7rem] uppercase tracking-[0.16em] text-slate-300">Reserved</p>
                <p className="mt-2 text-lg font-medium text-white">{account ? formatUsd(reservedAmount) : "—"}</p>
              </div>
            </div>
          </div>
          {account ? (
            <div className="border-t border-white/10 px-6 py-4 sm:px-8">
              <p className="text-sm text-slate-300">What your agents can safely spend after protections and reservations.</p>
            </div>
          ) : (
            <div className="border-t border-white/10 px-6 py-4 sm:px-8">
              <Link className="inline-flex rounded-full bg-white px-4 py-2 text-sm font-medium text-[#111d2b]" href={`/w/${workspaceId}/accounts`}>Connect a Nessie account</Link>
            </div>
          )}
        </Card>

        <div className="grid gap-4">
          <Card className="p-5">
            <p className="text-[0.7rem] uppercase tracking-[0.2em] text-slate-500">Active agents</p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className="text-3xl font-medium text-ink">{data.registrations.length}</p>
              <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-emerald-800">Active</span>
            </div>
            {data.registrations.length === 0 ? <Link className="mt-3 inline-block text-sm underline" href={`/w/${workspaceId}/bots`}>Create a Grok agent</Link> : <p className="mt-3 text-sm text-slate-600">{data.registrations[0].name}</p>}
          </Card>
          <Card className="p-5">
            <p className="text-[0.7rem] uppercase tracking-[0.2em] text-slate-500">Approvals</p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className="text-3xl font-medium text-ink">{data.approvalCount}</p>
              <span className={`inline-flex rounded-full px-2 py-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] ${data.approvalCount > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                {data.approvalCount > 0 ? "Pending" : "Clear"}
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-600">{data.approvalCount > 0 ? "Needs review before execution." : "Everything is running within policy."}</p>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold text-ink">Recent activity</h2>
            <span className="text-sm text-slate-500">Live</span>
          </div>
          {data.events.events.length === 0 ? <p className="mt-4 text-sm text-slate-600">No activity has been recorded in this workspace.</p> : (
            <ul className="mt-4 divide-y divide-line">
              {data.events.events.map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#111d2b]" />
                    <span className="text-sm text-ink">{eventLabels[event.eventType] ?? event.eventType.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())}</span>
                  </div>
                  <time className="text-xs uppercase tracking-[0.12em] text-slate-500" dateTime={new Date(event.createdAt).toISOString()}>{formatRelativeTime(event.createdAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="text-xl font-semibold text-ink">Protection status</h2>
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
              <span className="text-sm text-slate-600">Minimum account balance</span>
              <span className="text-sm font-medium text-ink">{account ? formatUsd(protectedAmount) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
              <span className="text-sm text-slate-600">Agent spending cap</span>
              <span className="text-sm font-medium text-ink">{account ? formatUsd(Math.max(0, protectedAmount / 3)) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-600">Approval required above</span>
              <span className="text-sm font-medium text-ink">{account ? formatUsd(Math.max(0, spendable * 0.2)) : "—"}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge>Nessie sandbox</Badge>
        {data.worker.dueJobs > 0 ? <Badge tone="warn">{data.worker.dueJobs} due jobs</Badge> : <Badge tone="good">Worker healthy</Badge>}
      </div>
    </div>
  );
}
