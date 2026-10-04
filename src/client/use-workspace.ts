"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
export function useWorkspace(workspaceId: string) {
  const query = useQuery({ queryKey: ["workspaces"], queryFn: () => api<{ workspaces: Array<{ id: string; role: string; kind: string }> }>("/api/workspaces") });
  return query.data?.workspaces.find((workspace) => workspace.id === workspaceId);
}
