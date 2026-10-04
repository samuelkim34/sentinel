"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../client/api";
import { authClient } from "../client/auth";
import { cn } from "./ui";

const links = [
  ["", "Overview"],
  ["/accounts", "Accounts"],
  ["/bots", "Bots"],
  ["/tasks", "Tasks"],
  ["/approvals", "Approvals"],
  ["/activity", "Activity"],
  ["/settings", "Settings"],
] as const;

type Workspace = { id: string; label: string; kind: string; role: string; timezone: string };

export function Shell({ workspaceId, children }: { workspaceId: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api<{ workspaces: Workspace[] }>("/api/workspaces"),
    refetchInterval: () => {
      if (typeof document === "undefined" || document.hidden) return false;
      return 10000;
    },
  });
  const current = workspaces.data?.workspaces.find((item) => item.id === workspaceId);

  async function signOut() {
    window.dispatchEvent(new Event("sentinel-session-ending"));
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message ?? "Sign-out failed.");
      queryClient.clear();
      router.push("/sign-in"); router.refresh();
    } catch (cause) { setSignOutError(cause instanceof Error ? cause.message : "Sign-out failed."); }
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="bg-nav text-slate-100 md:min-h-screen">
        <div className="flex items-center justify-between px-4 py-4">
          <div>
            <p className="text-lg font-semibold">Sentinel</p>
            <p className="text-sm text-slate-300">Financial control</p>
          </div>
          <button className="rounded border border-slate-600 px-2 py-1 text-sm md:hidden" type="button" onClick={() => setOpen((value) => !value)}>Menu</button>
        </div>
        <div className={cn("px-3 pb-4", open ? "block" : "hidden md:block")}>
          <p className="mb-3 px-1 text-sm">
            <span className="text-slate-400">Workspace</span>
            <span className="mt-1 block text-base text-white">{current?.label ?? "Loading workspace…"}</span>
          </p>
          {(workspaces.data?.workspaces.length ?? 0) > 1 ? (
            <label className="mb-3 block px-1 text-sm">
              Switch workspace
              <select
                className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-2"
                value={workspaceId}
                onChange={(event) => {
                  queryClient.clear();
                  router.push(`/w/${event.target.value}`);
                }}
              >
                {workspaces.data?.workspaces.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          <nav className="grid gap-1" aria-label="Workspace">
            {links.map(([href, label]) => {
              const path = `/w/${workspaceId}${href}`;
              const active = pathname === path;
              return <Link key={label} href={path} className={cn("rounded px-3 py-2 text-base", active ? "bg-blue text-white" : "hover:bg-slate-800")} aria-current={active ? "page" : undefined}>{label}</Link>;
            })}
          </nav>
          <p className="mt-4 px-3 text-sm text-slate-300">{current ? `${current.kind.toLowerCase()} · ${current.role}` : "Loading access"}</p>
          <button className="mt-3 px-3 text-sm underline" type="button" onClick={() => void signOut()}>Sign out</button>
          {signOutError && <p role="alert" className="px-3 text-sm">{signOutError}</p>}
        </div>
      </aside>
      <main className="px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
