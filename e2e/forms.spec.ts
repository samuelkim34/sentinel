import { expect, test, type Page, type BrowserContext } from '@playwright/test';

const password = 'correct-horse-battery';
let sessionCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];
async function signup(page: Page) {
  // Reuse one real signed-in user with a separate workspace for each case.
  // A burst of test signups must not require disabling production auth limits.
  if (sessionCookies.length) {
    await page.context().addCookies(sessionCookies);
    await page.goto('/onboarding');
  } else {
  await page.goto('/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Form regression owner');
  await page.getByLabel('Email').fill(`forms-${Date.now()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  }
  await page.getByLabel('Workspace name').fill('Form regression workspace');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect a bank account' })).toBeVisible();
  sessionCookies = await page.context().cookies();
  return page.url().match(/\/w\/([^/]+)/)![1];
}
async function confirm(page: Page, label: string) {
  const field = page.getByLabel(label, { exact: true });
  await field.click();
  await field.fill(password);
}
async function accountFields(page: Page, nickname: string) {
  const values = { 'First name': 'River', 'Last name': 'Owner', 'Street address': '123 Main Street', City: 'Fairfax', State: 'VA', ZIP: '22030', Nickname: nickname, 'Initial balance': '1000.00' };
  for (const [label, value] of Object.entries(values)) await page.getByLabel(label, { exact: true }).fill(value);
  await confirm(page, 'Confirm your password');
}
async function createAccount(page: Page, nickname: string) {
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await accountFields(page, nickname);
  await page.getByRole('button', { name: 'Create sandbox account', exact: true }).click();
  await expect(page.getByRole('heading', { name: nickname, exact: true })).toBeVisible();
}
async function makeAgent(page: Page, workspaceId: string, walletIds: string[] = []) {
  const result = await page.request.post(`/api/workspaces/${workspaceId}/agents`, { headers: { origin: 'http://127.0.0.1:43119' }, data: { name: 'Form test agent', purpose: 'Recorded research', instructions: '', walletIds } });
  expect(result.status()).toBe(201);
  return (await result.json()).id as string;
}

test('account forms reject email in money fields, clear successes and preserve failed drafts', async ({ page }) => {
  await signup(page);
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.getByLabel('Confirm your password')).toHaveValue('');
  await expect(page.getByLabel('Confirm your password')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Initial balance')).toHaveAttribute('type', 'number');
  await page.getByLabel('Initial balance').evaluate((input: HTMLInputElement) => { input.value = 'saved-login@example.com'; });
  await expect(page.getByLabel('Initial balance')).toHaveValue('');
  await accountFields(page, 'First account');
  await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('Savings');
  await page.getByRole('button', { name: 'Create sandbox account', exact: true }).click();
  await expect(page.getByText('Sandbox account created. The form is ready for another account.')).toBeVisible();
  for (const label of ['First name', 'Last name', 'Street address', 'City', 'State', 'ZIP', 'Nickname', 'Initial balance', 'Confirm your password']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('Checking');
  await accountFields(page, 'Reject account');
  await page.getByRole('button', { name: 'Create sandbox account', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Nessie rejected/ })).toBeVisible();
  await expect(page.getByLabel('Nickname')).toHaveValue('Reject account');
  await expect(page.getByLabel('Initial balance')).toHaveValue('1000.00');
  await expect(page.getByLabel('Confirm your password')).toHaveValue('');
  await page.getByLabel('Nickname').fill('Second account');
  await confirm(page, 'Confirm your password');
  await page.getByRole('button', { name: 'Create sandbox account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Second account', exact: true })).toBeVisible();
  await expect(page.getByLabel('Nickname')).toHaveValue('');
});

test('allowance and protection confirmations stay independent and clear after use', async ({ page }) => {
  const workspaceId = await signup(page);
  await createAccount(page, 'Authority account');
  const response = await page.request.get(`/api/workspaces/${workspaceId}/accounts`);
  const walletId = (await response.json()).accounts[0].id as string;
  const agentId = await makeAgent(page, workspaceId, [walletId]);
  await page.goto(`/w/${workspaceId}/bots/${agentId}`);
  for (const label of ['Lifetime allowance', 'Per-purchase cap', 'Review above']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('type', 'number');
  }
  await expect(page.getByLabel('Confirm password', { exact: true })).toHaveValue('');
  await page.getByLabel('Lifetime allowance').fill('200.00');
  await page.getByLabel('Per-purchase cap').fill('50.00');
  await page.getByLabel('Review above').fill('25.00');
  await page.getByLabel('Expires', { exact: true }).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await confirm(page, 'Confirm password');
  await page.getByRole('button', { name: 'Grant new allowance' }).click();
  await expect(page.getByText('Lifetime allowance granted.', { exact: true })).toBeVisible();
  for (const label of ['Lifetime allowance', 'Per-purchase cap', 'Review above', 'Expires', 'Confirm password']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  await page.goto(`/w/${workspaceId}/accounts/${walletId}`);
  await confirm(page, 'Password for baseline');
  await expect(page.getByLabel('Confirm password', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Set policy baseline from observation' }).click();
  await expect(page.getByText('Policy baseline updated.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Password for baseline')).toHaveValue('');
  await page.getByLabel('Label', { exact: true }).fill('Rent');
  await page.getByLabel('Amount', { exact: true }).fill('100.00');
  await confirm(page, 'Confirm password');
  await page.getByRole('button', { name: 'Save protection', exact: true }).click();
  await expect(page.getByText('Protection saved.', { exact: true })).toBeVisible();
  for (const label of ['Label', 'Amount', 'Confirm password']) await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
});

test('task creation clears successful drafts and retains a rejected purchase draft', async ({ page }) => {
  const workspaceId = await signup(page);
  const agentId = await makeAgent(page, workspaceId);
  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('First research');
  await page.getByLabel('Desired outcome').fill('Read recorded facts');
  await page.getByRole('combobox', { name: 'Bot', exact: true }).selectOption(agentId);
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByText('Task created. The form is ready for another task.')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Desired outcome')).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Bot', exact: true })).toHaveValue('');
  await page.getByLabel('Title', { exact: true }).fill('Next draft');
  await page.getByLabel('Desired outcome').fill('Keep this outcome');
  await page.getByRole('combobox', { name: 'Kind', exact: true }).selectOption('PURCHASE');
  await page.getByRole('combobox', { name: 'Bot', exact: true }).selectOption(agentId);
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /mandate|allowance/i })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Next draft');
  await expect(page.getByLabel('Desired outcome')).toHaveValue('Keep this outcome');
  await page.getByRole('combobox', { name: 'Kind', exact: true }).selectOption('RESEARCH');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Next draft', exact: true })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('');
});

test('external revoke disappears after success and remains revoked after reload', async ({ page }) => {
  const workspaceId = await signup(page);
  const headers = { origin: 'http://127.0.0.1:43119' };
  const created = await page.request.post(`/api/workspaces/${workspaceId}/registrations`, { headers, data: { name: 'Legacy registration', purpose: 'Optional external integration', walletIds: [] } });
  expect(created.status()).toBe(201);
  const agentId = (await created.json()).id as string;
  const connected = await page.request.post(`/api/workspaces/${workspaceId}/registrations/${agentId}/connections`, { headers, data: { mode: 'PERSONAL_TOKEN' } });
  expect(connected.status()).toBe(201);
  await page.goto(`/w/${workspaceId}/bots/${agentId}`);
  await page.getByRole('button', { name: 'Revoke current connection', exact: true }).click();
  await expect(page.getByText('Connection revoked. No external connection is active.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revoke current connection', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Connection revoked. No external connection is active.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revoke current connection', exact: true })).toHaveCount(0);
});

test('merchant sync displays counts, real errors and an empty provider result without losing the catalog', async ({ page }) => {
  await signup(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/No merchants yet/)).toBeVisible();
  await page.getByRole('button', { name: 'Import existing only', exact: true }).click();
  await expect(page.getByText('Sync completed: 2 merchants imported or updated.', { exact: true })).toBeVisible();
  await expect(page.getByText('First bank merchant · UNKNOWN', { exact: true })).toBeVisible();
  await expect(page.getByText('Second bank merchant · UNKNOWN', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Import existing only', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Merchant sync failed: Nessie rejected the request \(401\)/ })).toBeVisible();
  await expect(page.getByText('First bank merchant · UNKNOWN', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Import existing only', exact: true }).click();
  await expect(page.getByText('Nessie returned no merchants. Click Sync Nessie merchants to create the sample catalog.', { exact: true })).toBeVisible();
  await expect(page.getByText('First bank merchant · UNKNOWN', { exact: true })).toBeVisible();
});

test('merchant setup creates the catalog in Settings and confirms suggested categories together', async ({ page }) => {
  await signup(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sync Nessie merchants', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Created 50, renamed 0, already present 0.' })).toBeVisible();
  await expect(page.getByText('Staples · UNKNOWN · Suggested: OFFICE', { exact: true })).toBeVisible();
  await page.getByLabel('Category for Target', { exact: true }).selectOption('OFFICE');
  await expect(page.getByText('Target · OFFICE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm 49 suggested categories', exact: true }).click();
  await expect(page.getByText('Confirmed 49 categories. 0 already confirmed categories were kept.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Category for Staples', { exact: true })).toHaveValue('OFFICE');
  await expect(page.getByLabel('Category for Target', { exact: true })).toHaveValue('OFFICE');
  await expect(page.getByRole('button', { name: /Confirm \d+ suggested categories/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sync Nessie merchants', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Created 0, renamed 0, already present 50.' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Category for Staples', { exact: true })).toHaveValue('OFFICE');
  await expect(page.getByLabel('Category for Target', { exact: true })).toHaveValue('OFFICE');
});
