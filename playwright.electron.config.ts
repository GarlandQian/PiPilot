import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/electron',
  outputDir: './test-results/electron',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
