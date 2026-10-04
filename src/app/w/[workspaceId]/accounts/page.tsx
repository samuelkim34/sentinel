"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatUsd, formatWhen } from "../../../../client/api";
import { Badge, Button, Card, Field, Input, MoneyInput } from "../../../../components/ui";
import { PasswordConfirmation } from "../../../../components/password-confirmation";
import { useState } from "react";
import { useWorkspace } from "../../../../client/use-workspace";

type Account = { id: string; label: string; policyBalanceCents: number; observedBalanceCents: number | null; spendableCents: number; protectedCents: number; reservedCents: number; state: string; lastVerifiedAt: number; provider: string };

export default function AccountsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const owner = useWorkspace(workspaceId)?.role === "owner";
  const accounts = useQuery({
    queryKey: ["accounts", workspaceId],
    queryFn: () => api<{ accounts: Account[] }>(`/api/workspaces/${workspaceId}/accounts`),
    refetchInterval: () => {
      if (typeof document === "undefined" || document.hidden) return false;
      return 10000;
    },
  });
  const config = useQuery({ queryKey: ["config"], queryFn: () => api<{ nessieConfigured: boolean }>("/api/configuration") });
  const create = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { password, street, ...details } = body;
      const address = String(street ?? "").trim();
      const parts = address.split(/\s+/).filter(Boolean);
      const streetNumber = parts.shift() ?? "";
      const streetName = parts.join(" ");
      await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
      return api(`/api/workspaces/${workspaceId}/banking/provision`, {
        method: "POST",
        body: JSON.stringify({ ...details, streetNumber, streetName }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts", workspaceId] }),
    onSettled: () => setPassword(""),
  });

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[0.7rem] uppercase tracking-[0.22em] text-slate-500">Accounts</p>
          <h1 className="mt-2 font-serif text-4xl text-ink">Banking controls</h1>
        </div>
        <Badge tone="good">Sandbox mode</Badge>
      </header>

      {config.data && !config.data.nessieConfigured ? <p role="status" className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">NESSIE_API_KEY is not configured on the server. Sentinel will not show fabricated accounts.</p> : null}
      {accounts.isLoading ? <p role="status">Loading accounts…</p> : null}
      {accounts.isError ? <p role="alert">{accounts.error.message}</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-[0.7rem] uppercase tracking-[0.14em] text-slate-500">Connected</p>
          <p className="mt-3 text-3xl font-medium text-ink">{accounts.data?.accounts.length ?? 0}</p>
        </Card>
        <Card className="p-5">
          <p className="text-[0.7rem] uppercase tracking-[0.14em] text-slate-500">Spendable</p>
          <p className="mt-3 text-3xl font-medium text-ink">{accounts.data?.accounts[0] ? formatUsd(accounts.data.accounts[0].spendableCents) : "—"}</p>
        </Card>
        <Card className="p-5">
          <p className="text-[0.7rem] uppercase tracking-[0.14em] text-slate-500">Protected</p>
          <p className="mt-3 text-3xl font-medium text-ink">{accounts.data?.accounts[0] ? formatUsd(accounts.data.accounts[0].protectedCents) : "—"}</p>
        </Card>
      </div>

      {accounts.data?.accounts.length === 0 ? <p className="rounded-2xl border border-dashed border-line bg-[#f8f5f1] p-4 text-sm text-slate-600">No account connected.</p> : null}
      <div className="grid gap-3">
        {accounts.data?.accounts.map((account) => (
          <Card key={account.id} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xl font-semibold text-ink">{account.label}</h2>
                <p className="text-sm text-slate-600">{account.provider}</p>
              </div>
              <Badge tone={account.state === "QUARANTINED" ? "warn" : "good"}>{account.state}</Badge>
            </div>
            <dl className="mt-4 grid gap-3 font-mono text-sm md:grid-cols-4">
              <div className="rounded-xl bg-[#f2eee7] p-3"><dt className="text-[0.7rem] uppercase tracking-[0.14em] text-slate-500">Sentinel spending balance</dt><dd className="mt-2 text-base text-ink">{formatUsd(account.policyBalanceCents)}</dd></div>
              <div className="rounded-xl bg-[#f2eee7] p-3"><dt className="text-[0.7rem] uppercase tracking-[0.14em] text-slate-500">Nessie reported</dt><dd className="mt-2 text-base text-ink">{formatUsd(account.observedBalanceCents)}</dd></div>
              <div className="rounded-xl bg-[#f2eee7] p-3"><dt className="text-[0.7rem] uppercase tracking-[0.14em] text-slate-500">Spendable</dt><dd className="mt-2 text-base text-ink">{formatUsd(account.spendableCents)}</dd></div>
              <div className="rounded-xl bg-[#f2eee7] p-3"><dt className="text-[0.7rem] uppercase tracking-[0.14em] text-slate-500">Verified</dt><dd className="mt-2 text-base text-ink">{formatWhen(account.lastVerifiedAt)}</dd></div>
            </dl>
            <Link className="mt-4 inline-block text-sm font-medium text-[#15212d] underline underline-offset-4" href={`/w/${workspaceId}/accounts/${account.id}`}>Open account</Link>
          </Card>
        ))}
      </div>

      {owner && <Card className="p-5">
        <h2 className="text-xl font-semibold text-ink">Create a sandbox customer and account</h2>
        <p className="mt-1 text-sm text-slate-600">The initial balance is created upstream and read back. It is not invented locally.</p>
        <form autoComplete="off" className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => {
          event.preventDefault();
          const element = event.currentTarget;
          const form = new FormData(element);
          create.mutate({ ...Object.fromEntries(form.entries()), password }, { onSuccess: () => element.reset() });
        }}>
          <fieldset disabled={create.isPending} className="contents">
          {[
            { name: "firstName", label: "First name" },
            { name: "lastName", label: "Last name" },
            { name: "street", label: "Street address" },
            { name: "city", label: "City" },
            { name: "state", label: "State" },
            { name: "zip", label: "ZIP" },
            { name: "nickname", label: "Nickname" },
          ].map(({ name, label }) => (
            <Field key={name} label={label}><Input name={name} autoComplete="off" required /></Field>
          ))}
          <Field label="Initial balance"><MoneyInput name="balance" required placeholder="100.00" /></Field>
          <Field label="Confirm your password"><PasswordConfirmation value={password} onChange={event => setPassword(event.target.value)} required /></Field>
          <Field label="Type">
            <select name="accountType" className="w-full rounded-xl border border-line bg-[#f8f4ef] px-3.5 py-2.5 text-base text-ink"><option>Checking</option><option>Savings</option></select>
          </Field>
          {create.isError ? <p role="alert" className="md:col-span-2 text-rose-800">{create.error.message}</p> : null}
          {create.isSuccess && <p role="status" className="md:col-span-2">Sandbox account created. The form is ready for another account.</p>}
          <Button className="md:col-span-2" type="submit" disabled={create.isPending || !config.data?.nessieConfigured || !password}>Create sandbox account</Button>
          </fieldset>
        </form>
      </Card>}
      {owner && <Card className="p-5">
        <h2 className="text-xl font-semibold text-ink">Link an existing sandbox customer</h2>
        <p className="mt-1 text-sm text-slate-600">An operator must grant a link permission for that customer id before this succeeds. Sentinel does not treat a customer id as proof you own a real bank account.</p>
        <LinkForm workspaceId={workspaceId} bankingConfigured={Boolean(config.data?.nessieConfigured)} onLinked={() => queryClient.invalidateQueries({ queryKey: ["accounts", workspaceId] })} />
      </Card>}
    </div>
  );
}

function LinkForm({ workspaceId, bankingConfigured, onLinked }: { workspaceId: string; bankingConfigured: boolean; onLinked: () => void }) {
  const link = useMutation({
    mutationFn: (body: { customerId: string; accountId: string }) => api(`/api/workspaces/${workspaceId}/banking/link`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: onLinked,
  });
  const candidates = useQuery({
    queryKey: ["link-candidates", workspaceId],
    queryFn: () => api<{ customers: Array<{ customerId: string; accounts: Array<{ externalId: string; label: string; balanceCents: number }>; error: string | null }>; linked: Array<{ customerId: string; accountId: string; label: string }> }>(`/api/workspaces/${workspaceId}/banking/customers`),
    enabled: bankingConfigured,
  });
  return (
    <form autoComplete="off" className="mt-4 grid gap-3" onSubmit={(event) => {
      event.preventDefault();
      const element = event.currentTarget;
      const form = new FormData(element);
      link.mutate({ customerId: String(form.get("customerId")), accountId: String(form.get("accountId")) }, { onSuccess: () => element.reset() });
    }}>
      <Field label="Customer id"><Input name="customerId" list="permitted-customers" required /></Field>
      <datalist id="permitted-customers">{candidates.data?.customers.map((customer) => <option key={customer.customerId} value={customer.customerId} />)}</datalist>
      <Field label="Account id"><Input name="accountId" list="permitted-accounts" required /></Field>
      <datalist id="permitted-accounts">{candidates.data?.customers.flatMap((customer) => customer.accounts.map((account) => <option key={account.externalId} value={account.externalId}>{account.label}</option>))}</datalist>
      {candidates.data?.customers.length === 0 && <p className="text-sm">No customer has a link permission yet.</p>}
      {candidates.data?.customers.map((customer) => <div className="text-sm" key={customer.customerId}><p>Permitted customer: {customer.customerId}</p>{customer.error ? <p role="alert">{customer.error}</p> : customer.accounts.map((account) => <p key={account.externalId}>{account.label} · {account.externalId} · {formatUsd(account.balanceCents)}</p>)}</div>)}
      {candidates.isError ? <p className="text-sm">Candidate lookup: {candidates.error.message}</p> : null}
      {link.isError ? <p role="alert">{link.error.message}</p> : null}
      <Button type="submit" variant="quiet" disabled={link.isPending || !bankingConfigured}>Link permitted account</Button>
    </form>
  );
}
