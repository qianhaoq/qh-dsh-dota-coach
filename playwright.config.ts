import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4178',
    headless: true,
    channel: 'chromium',
    viewport: { width: 1360, height: 1000 },
  },
  webServer: {
    command: 'pnpm exec tsx scripts/ui-test-server.ts',
    port: 4178,
    reuseExistingServer: false,
  },
  reporter: 'list',
})
