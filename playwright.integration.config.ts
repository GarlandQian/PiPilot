import { defineConfig } from '@playwright/test'
import electronConfig from './playwright.electron.config'

export default defineConfig({
  ...electronConfig,
  outputDir: './test-results/integration',
  grep: /@integration\b/,
})
