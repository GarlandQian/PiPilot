import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/electron',
  outputDir: './test-results/electron',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  // Hosted runners are slower than local machines: retry once in CI and report the test as flaky.
  retries: process.env.CI ? 1 : 0,
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
