import { expect, test } from '@playwright/test';

test.use({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.44' } });
for (const kind of ['PERSONAL','BUSINESS']) test(`${kind.toLowerCase()} users create and configure agents entirely on-site with honest missing-key states`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Agent owner');
  await page.getByLabel('Email').fill(`agent-${kind}-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Workspace name').fill(`${kind} workspace`);
  await page.getByRole('combobox', { name: 'Kind', exact: true }).selectOption(kind);
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect a bank account', exact: true })).toBeVisible();
  const workspaceId = new URL(page.url()).pathname.split('/')[2];
  for (const path of ['accounts','bots','tasks','approvals','activity','settings']) {
    // Full navigation forces server rendering and catches browser globals used
    // during query observer construction, including the original document bug.
    const response = await page.goto(`/w/${workspaceId}/${path}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('main')).toBeVisible();
  }
  await page.goto(`/w/${workspaceId}/bots`);
  await expect(page.getByText('No agents yet. Create your first agent below.')).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('My finance agent');
  await page.getByLabel('Purpose', { exact: true }).fill('Explain spending and research my cash flow');
  await page.getByLabel('Instructions', { exact: true }).fill('Be concise and cite recorded facts.');
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My finance agent', exact: true })).toBeVisible();
  await expect(page.getByLabel('Agent instructions')).toHaveValue('Be concise and cite recorded facts.');
  await expect(page.getByRole('heading', { name: 'Chat with your agent', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await expect(page.getByText('Native Grok Bot setup')).toHaveCount(0);
  await page.getByLabel('Agent name').fill('Updated agent');
  await page.getByLabel('Agent instructions').fill('Explain uncertainty plainly.');
  await page.getByRole('button', { name: 'Save agent configuration', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updated agent', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Agent instructions')).toHaveValue('Explain uncertainty plainly.');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
