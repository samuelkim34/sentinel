"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatUsd, formatWhen } from "../../../../client/api";
import { Badge, Button, Card, Field, Input } from "../../../../components/ui";
import { useWorkspace } from "../../../../client/use-workspace";

type Account = { id: string; label: string; policyBalanceCents: number; observedBalanceCents: number | null; spendableCents: number; protectedCents: number; reservedCents: number; state: string; lastVerifiedAt: number; provider: string };

export default function AccountsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  const owner = useWorkspace(workspaceId)?.role === "owner";
  const accounts = useQuery({
    queryKey: ["accounts", workspaceId],
    queryFn: () => api<{ accounts: Account[] }>(`/api/workspaces/${workspaceId}/accounts`),
    refetchInterval: () => (document.hidden ? false : 10000),
  });
  const config = useQuery({ queryKey: ["config"], queryFn: () => api<{ nessieConfigured: boolean }>("/api/configuration") });
  const create = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { password, ...details } = body;
      await api("/api/reauth", { method: "POST", body: JSON.stringify({ password }) });
      return api(`/api/workspaces/${workspaceId}/banking/provision`, { method: "POST", body: JSON.stringify(details) });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts", workspaceId] }),
  });

  return (
    <div className="grid gap-4">
      <h1 className="text-3xl font-semibold">Accounts</h1>
      <p>Connections are labeled Nessie sandbox. This is not a Capital One login and it does not prove ownership of a real customer account.</p>
      {config.data && !config.data.nessieConfigured ? <p role="status" className="rounded border border-amber-300 bg-amber-50 p-3">NESSIE_API_KEY is not configured on the server. Sentinel will not show fabricated accounts.</p> : null}
      {accounts.isLoading ? <p role="status">Loading accounts…</p> : null}
      {accounts.isError ? <p role="alert">{accounts.error.message}</p> : null}
      {accounts.data?.accounts.length === 0 ? <p>No account connected.</p> : null}
      <div className="grid gap-3">
        {accounts.data?.accounts.map((account) => (
          <Card key={account.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xl font-semibold">{account.label}</h2>
                <p className="text-sm">{account.provider}</p>
              </div>
              <Badge tone={account.state === "QUARANTINED" ? "warn" : "good"}>{account.state}</Badge>
            </div>
            <dl className="mt-3 grid gap-2 font-mono text-sm md:grid-cols-4">
              <div><dt>Policy balance</dt><dd>{formatUsd(account.policyBalanceCents)}</dd></div>
              <div><dt>Observed</dt><dd>{formatUsd(account.observedBalanceCents)}</dd></div>
              <div><dt>Spendable</dt><dd>{formatUsd(account.spendableCents)}</dd></div>
              <div><dt>Verified</dt><dd>{formatWhen(account.lastVerifiedAt)}</dd></div>
            </dl>
            <Link className="mt-3 inline-block underline" href={`/w/${workspaceId}/accounts/${account.id}`}>Open account</Link>
          </Card>
        ))}
      </div>
      {owner && <Card>
        <h2 className="text-xl font-semibold">Create a sandbox customer and account</h2>
        <p className="mt-1 text-sm">The initial balance is created upstream and read back. It is not invented locally.</p>
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          create.mutate(Object.fromEntries(form.entries()));
        }}>
          {["firstName", "lastName", "streetNumber", "streetName", "city", "state", "zip", "nickname"].map((name) => (
            <Field key={name} label={name}><Input name={name} required /></Field>
          ))}
          <Field label="Initial balance"><Input name="balance" required placeholder="100.00" /></Field>
          <Field label="Confirm your password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
          <Field label="Type">
            <select name="accountType" className="w-full rounded-md border border-line px-3 py-2"><option>Checking</option><option>Savings</option></select>
          </Field>
          {create.isError ? <p role="alert" className="md:col-span-2 text-rose-800">{create.error.message}</p> : null}
          <Button type="submit" disabled={create.isPending || !config.data?.nessieConfigured}>Create sandbox account</Button>
        </form>
      </Card>}
      {owner && <Card>
        <h2 className="text-xl font-semibold">Link an existing sandbox customer</h2>
        <p className="mt-1 text-sm">An operator must grant a link permission for that customer id before this succeeds. Sentinel does not treat a customer id as proof you own a real bank account.</p>
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
    <form className="mt-4 grid gap-3" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      link.mutate({ customerId: String(form.get("customerId")), accountId: String(form.get("accountId")) });
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
