import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: '**/forms.spec.ts',
  testIgnore: [],
  use: { ...base.use, actionTimeout: 10000 },
  webServer: {
    ...base.webServer,
    command: 'node scripts/start.mjs',
    env: { ...(base.webServer as { env: Record<string, string> }).env, NESSIE_API_KEY: 'isolated-forms-test-key', NESSIE_BASE_URL: 'https://api.nessieisreal.com', NODE_OPTIONS: '--import tsx --import ./e2e/banking-provider.ts' },
  },
});
