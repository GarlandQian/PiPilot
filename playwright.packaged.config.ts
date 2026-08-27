import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/packaged',
  outputDir: './test-results/packaged',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
