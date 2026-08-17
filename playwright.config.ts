import { defineConfig } from '@playwright/test'

export default defineConfig({
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'ui',
      testDir: './e2e',
      testMatch: /\.spec\.ts$/,
      testIgnore: /ai-.*\.spec\.ts$/,
    },
    {
      name: 'ai',
      testDir: './e2e',
      testMatch: /ai-.*\.spec\.ts$/,
      timeout: 120000,
    },
  ],
})
