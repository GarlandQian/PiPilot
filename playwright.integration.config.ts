import { defineConfig } from '@playwright/test'
import electronConfig from './playwright.electron.config'

export default defineConfig({
  ...electronConfig,
  outputDir: './test-results/integration',
  grep: /runs the local Pi RPC workflow|applies terminal font settings live|launches a sandboxed shell/,
})
