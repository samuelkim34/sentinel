import { getEnv } from '../server/env';
import type { DatabaseSync } from 'node:sqlite';
import { searchProducts } from '../banking/sandbox-products';
import { listMerchants } from './accounts';
import type { HumanContext } from './access';
import { invalid } from '../contracts/errors';

const key = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
export function listProducts(db: DatabaseSync, human: HumanContext, search = '') {
  const merchants = listMerchants(db, human);
  return searchProducts(search).map(product => {
    const matches = merchants.filter(m => key(m.label) === key(product.merchant));
    const merchant = matches.length === 1 ? matches[0] : undefined;
    return { ...product, unitPriceCents: getEnv().NESSIE_WHOLE_DOLLARS_ONLY ? Math.ceil(product.unitPriceCents / 100) * 100 : product.unitPriceCents, wholeDollarMode: getEnv().NESSIE_WHOLE_DOLLARS_ONLY, currency: 'USD', sandbox: true, merchantId: merchant?.id ?? null,
      verifiedCategory: merchant?.verifiedCategory ?? 'UNKNOWN',
      available: Boolean(merchant), unavailableReason: merchant ? null : matches.length ? 'Duplicate merchants: resolve the catalog mapping.' : 'Sync this merchant first.' };
  });
}
export function quoteProduct(db: DatabaseSync, human: HumanContext, productId: string, quantity: number, maxTotalCents: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100 || !Number.isSafeInteger(maxTotalCents) || maxTotalCents < 1) throw invalid('INVALID_PRODUCT_QUOTE', 'Use a quantity of 1–100 and a positive maximum in cents.');
  const product = listProducts(db, human).find(p => p.id === productId);
  if (!product?.merchantId) throw invalid('PRODUCT_UNAVAILABLE', 'Choose a catalog product with one synced merchant.');
  const amountCents = product.unitPriceCents * quantity;
  if (amountCents > maxTotalCents) throw invalid('PRODUCT_OVER_BUDGET', 'The catalog total exceeds the requested maximum.');
  return { merchantId: product.merchantId, amountCents,
    reason: `Sandbox catalog ${product.wholeDollarMode ? 'v1-whole-dollar' : 'v1'}: ${product.id}; ${quantity} × ${product.name}; unit ${product.unitPriceCents} USD cents; total ${amountCents} USD cents. Includes all simulated taxes/fees; no fulfillment or renewal.` };
}
