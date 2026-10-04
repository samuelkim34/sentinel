"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api, formatWhen } from "../../../../client/api";

type Graph = {
  nodes: Array<{ id: string; kind: string; label: string; position: { x: number; y: number } }>;
  edges: Array<{ id: string; source: string; target: string }>;
};

type EventPage = {
  events: Array<{ id: number; eventType: string; actorKind: string; subjectType: string; subjectId: string; createdAt: number; detail: Record<string, unknown> }>;
  nextCursor: number | null;
};

export default function ActivityPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const graph = useQuery({
    queryKey: ["activity", workspaceId],
    queryFn: () => api<Graph>(`/api/workspaces/${workspaceId}/activity-graph`),
    refetchInterval: 10000,
  });
  const events = useQuery({
    queryKey: ["events", workspaceId],
    queryFn: () => api<EventPage>(`/api/workspaces/${workspaceId}/events`),
    refetchInterval: 10000,
  });

  const nodes = (graph.data?.nodes ?? []).map((item) => ({
    id: item.id,
    position: item.position,
    data: { label: `${item.kind}\n${item.label}` },
    style: { width: 200, fontSize: 12, whiteSpace: "pre-wrap" as const },
  }));

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-3xl font-semibold">Activity</h1>
        <p>The graph is built from stored records for the latest visible task. It does not invent steps the bot did not record.</p>
      </header>
      {graph.isLoading ? <p role="status">Loading activity…</p> : null}
      {graph.isError ? <p role="alert">{graph.error.message}</p> : null}
      {graph.data && graph.data.nodes.length === 0 ? <p>No task has been recorded in this workspace yet.</p> : null}
      {nodes.length > 0 ? (
        <div className="h-[70vh] overflow-hidden rounded-lg border border-line bg-panel">
          <ReactFlow nodes={nodes} edges={graph.data?.edges ?? []} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}>
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      ) : null}
      <section>
        <h2 className="text-xl font-semibold">Audit</h2>
        {events.isLoading ? <p role="status">Loading audit…</p> : null}
        {events.isError ? <p role="alert">{events.error.message}</p> : null}
        {events.data?.events.length === 0 ? <p>No audit events yet.</p> : (
          <ul className="mt-2 divide-y divide-line">
            {events.data?.events.map((event) => (
              <li key={event.id} className="py-2">
                <p>{event.eventType} · {event.actorKind} · {event.subjectType}</p>
                <p className="text-sm text-slate-600">{formatWhen(event.createdAt)} · {event.subjectId}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
