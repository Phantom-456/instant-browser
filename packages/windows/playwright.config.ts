import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: 'tests/smoke', timeout: 30_000, workers: 1 })
