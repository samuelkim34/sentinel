import { expect, test } from '@playwright/test';

test('on-site chat queues a task and the running worker persists its research result', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/sign-up');
  await page.getByLabel('Name', { exact: true }).fill('Worker flow owner');
  await page.getByLabel('Email').fill(`worker-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Workspace name').fill('Actual worker flow');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByRole('link', { name: 'Bots', exact: true }).click();
  await expect(page.getByText('No agents yet. Create your first agent below.')).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('My cash flow agent');
  await page.getByLabel('Purpose', { exact: true }).fill('Research recorded finances');
  await page.getByRole('button', { name: 'Create agent', exact: true }).click();
  await expect(page.getByText(/Agent worker online/)).toBeVisible();
  await page.getByLabel('Message to agent').fill('Create a research task to review my cash flow.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Your research task is queued.', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Research completed and saved.', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.reload();
  await expect(page.getByText('Your research task is queued.', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Review my cash flow', exact: true }).click();
  await expect(page.getByText('Bot reported: complete — Research based on the recorded task is saved.', { exact: true })).toBeVisible();
  await expect(page.getByText(/RESEARCH · COMPLETED · revision/)).toBeVisible();
  expect(errors).toEqual([]);
});
