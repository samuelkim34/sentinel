import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: '**/agent-execution.spec.ts',
  testIgnore: [],
  webServer: {
    ...base.webServer,
    command: 'node scripts/start.mjs',
    env: { ...(base.webServer as { env: Record<string, string> }).env, XAI_API_KEY: 'isolated-browser-test-key', NODE_OPTIONS: '--import tsx --import ./e2e/agent-provider.ts' },
  },
});
