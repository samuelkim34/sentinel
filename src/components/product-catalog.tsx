"use client";
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, formatUsd } from '../client/api';
import { Card, Field, Input } from './ui';
type Product = { id: string; name: string; merchant: string; unitPriceCents: number; wholeDollarMode: boolean; available: boolean; verifiedCategory: string; unavailableReason: string | null };
export function ProductCatalog({ workspaceId }: { workspaceId: string }) {
  const [search, setSearch] = useState('');
  const catalog = useQuery({ queryKey: ['products', workspaceId], queryFn: () => api<{ products: Product[] }>(`/api/workspaces/${workspaceId}/products`), refetchInterval: 10000 });
  const words = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const products = catalog.data?.products.filter(p => words.every(w => `${p.name} ${p.merchant}`.toLowerCase().includes(w))) ?? [];
  return <Card>
    <h2 className="text-xl font-semibold">Sandbox products</h2>
    <p className="mt-2 text-sm">Fixed fictional USD prices, including all simulated taxes and fees. These are not current retailer quotes. No delivery, booking, service activation or recurring billing occurs.</p>
    <p className="mt-2 text-sm">Select a purchase allowance in agent chat, then ask: “Buy an eraser from Staples under $10.” Merchant categories and spending limits still apply.</p>
    {catalog.data?.products.some(p => p.wholeDollarMode) && <p role="status" className="mt-2 text-sm">Whole-dollar sandbox mode: sample unit prices are rounded up to whole dollars before selection. Existing purchase terms are unchanged.</p>}
    <div className="mt-4"><Field label="Search products or merchants"><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Eraser, Staples, notebook…" /></Field></div>
    {catalog.isLoading && <p role="status">Loading products…</p>}
    {catalog.isError && <p role="alert">{catalog.error.message}</p>}
    {catalog.data && <p className="mt-3 text-sm">{products.length} products</p>}
    <ul className="mt-3 grid max-h-[32rem] gap-3 overflow-auto sm:grid-cols-2">{products.map(p => <li key={p.id} className="rounded-xl border border-line p-3">
      <p className="font-medium">{p.name} · {formatUsd(p.unitPriceCents)}</p>
      <p className="text-sm">{p.merchant} · {p.verifiedCategory}</p>
      <p className="text-sm">{p.available ? p.verifiedCategory === 'UNKNOWN' ? 'Confirm the merchant category in Settings → Merchants before purchasing.' : 'Merchant linked. Purchase is subject to your allowance.' : p.unavailableReason}</p>
    </li>)}</ul>
    {catalog.data && !products.length && <p>No matching products. Try a simpler keyword.</p>}
  </Card>;
}
