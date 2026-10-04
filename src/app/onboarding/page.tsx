"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../client/api";
import { Button, Field, Input } from "../../components/ui";

export default function OnboardingPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Create a workspace</h1>
      <p className="mt-2 text-slate-700">A personal workspace has one owner. A business workspace can invite finance staff and members.</p>
      <form className="mt-6 grid gap-4" method="post" onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError("");
        const form = new FormData(event.currentTarget);
        try {
          const created = await api<{ id: string }>("/api/workspaces", {
            method: "POST",
            body: JSON.stringify({
              label: form.get("workspaceName"),
              kind: form.get("kind"),
              timezone: form.get("timezone"),
            }),
          });
          router.push(`/w/${created.id}`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Workspace creation failed.");
        } finally { setPending(false); }
      }}>
        <Field label="Workspace name">
          <Input id="workspace-name" name="workspaceName" type="text" required autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="Northwind household" />
        </Field>
        <Field label="Kind">
          <select name="kind" className="w-full rounded-md border border-line bg-panel px-3 py-2">
            <option value="PERSONAL">Personal</option>
            <option value="BUSINESS">Business</option>
          </select>
        </Field>
        <Field label="Timezone">
          <Input name="timezone" defaultValue="America/New_York" required />
        </Field>
        {error ? <p role="alert" className="text-rose-800">{error}</p> : null}
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create workspace"}</Button>
      </form>
    </main>
  );
}
