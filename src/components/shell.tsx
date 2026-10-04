"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../client/api";
import { authClient } from "../client/auth";
import { cn } from "./ui";

const links = [
  ["", "Overview", "home"],
  ["/accounts", "Accounts", "ledger"],
  ["/bots", "Bots", "bot"],
  ["/tasks", "Tasks", "tasks"],
  ["/approvals", "Approvals", "approval"],
  ["/activity", "Activity", "activity"],
  ["/settings", "Settings", "settings"],
] as const;

type Workspace = { id: string; label: string; kind: string; role: string; timezone: string };

function NavIcon({ name }: { name: string }) {
  const shared = "h-4 w-4 stroke-[1.7]";
  const pathMap: Record<string, React.ReactNode> = {
    home: <path key="home" d="M3 10.5 12 3l9 7.5v8.5a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" className={shared} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />,
    ledger: <path key="ledger" d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5zm0 0h16M8 4v16M8 9h8M8 13h8" className={shared} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />,
    bot: <path key="bot" d="M8 8.5A3.5 3.5 0 0 1 11.5 5h1A3.5 3.5 0 0 1 16 8.5v1.1A3.5 3.5 0 0 1 12.5 13h-1A3.5 3.5 0 0 1 8 9.6zm0 0V16m8-7.5V16m-8 0h8M9.5 19h5M12 13v6" className={shared} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />,
    tasks: <path key="tasks" d="M7 6.5h10m-10 5h10M7 17h10M4 6.5h.01M4 11.5h.01M4 16.5h.01" className={shared} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />,
    approval: <path key="approval" d="M12 3.5 18.5 6v5.5c0 3.8-2.7 7.2-6.5 9-3.8-1.8-6.5-5.2-6.5-9V6L12 3.5Zm-2.2 8 1.7 1.7 3.8-4" className={shared} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />,
    activity: <path key="activity" d="M3 13.5h4l2-6 4 12 2-6h6" className={shared} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />,
    settings: <path key="settings" d="M12 8.5A3.5 3.5 0 1 1 12 15.5A3.5 3.5 0 0 1 12 8.5Zm9 3.5-1.3-.7a7.5 7.5 0 0 0-.6-1.7l.7-1.3-1.5-1.5-1.3.7a7.5 7.5 0 0 0-1.7-.6L13.5 3h-3l-.7 1.3a7.5 7.5 0 0 0-1.7.6L6.8 4.2 5.3 5.7l.7 1.3a7.5 7.5 0 0 0-.6 1.7L4.1 10.5v3l1.3.7a7.5 7.5 0 0 0 .6 1.7l-.7 1.3 1.5 1.5 1.3-.7a7.5 7.5 0 0 0 1.7.6l.7 1.3h3l.7-1.3a7.5 7.5 0 0 0 1.7-.6l1.3.7 1.5-1.5-.7-1.3a7.5 7.5 0 0 0 .6-1.7l1.3-.7z" className={shared} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={shared}>{pathMap[name] ?? pathMap.home}</svg>;
}

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
    <div className="min-h-screen bg-paper md:grid md:grid-cols-[220px_1fr]">
      <aside className="flex flex-col bg-nav text-slate-100 md:min-h-screen">
        <div className="flex items-center justify-between px-4 py-5">
          <div className="flex items-center gap-3">
            <span className="brand-mark">S</span>
            <div>
              <p className="text-lg font-semibold leading-none">Sentinel</p>
              <p className="text-[0.7rem] uppercase tracking-[0.22em] text-slate-300">Financial control</p>
            </div>
          </div>
          <button className="rounded border border-slate-600 px-2 py-1 text-sm md:hidden" type="button" onClick={() => setOpen((value) => !value)}>Menu</button>
        </div>
        <div className={cn("flex flex-1 flex-col px-3 pb-4", open ? "block" : "hidden md:flex")}>
          <div className="mb-4 px-2 pt-2">
            <p className="text-[0.7rem] uppercase tracking-[0.2em] text-slate-400">Workspace</p>
            <p className="mt-2 text-base font-medium text-white">{current?.label ?? "Loading workspace…"}</p>
          </div>
          {(workspaces.data?.workspaces.length ?? 0) > 1 ? (
            <label className="mb-4 block px-2 text-sm text-slate-300">
              <span className="mb-1 block text-[0.7rem] uppercase tracking-[0.2em] text-slate-400">Switch</span>
              <select
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-2 text-slate-100"
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
          <nav className="grid gap-1.5" aria-label="Workspace">
            {links.map(([href, label, icon]) => {
              const path = `/w/${workspaceId}${href}`;
              const active = pathname === path;
              return <Link key={label} href={path} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors", active ? "bg-[#edf3f9] text-[#101a25]" : "text-slate-300 hover:bg-white/5 hover:text-white")} aria-current={active ? "page" : undefined}>
                <NavIcon name={icon} />
                <span>{label}</span>
              </Link>;
            })}
          </nav>

          <div className="mt-auto pt-6">
            <p className="px-3 text-sm text-slate-300">{current ? `${current.kind.toLowerCase()} · ${current.role}` : "Loading access"}</p>
            <button className="mt-3 px-3 text-sm text-slate-200 underline decoration-slate-500 underline-offset-4" type="button" onClick={() => void signOut()}>Sign out</button>
            {signOutError && <p role="alert" className="mt-2 px-3 text-sm text-amber-200">{signOutError}</p>}
          </div>
        </div>
      </aside>
      <main className="px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
