import { defineConfig } from '@playwright/test'

// The app tests start the real app. By default its windows are invisible and ignore your mouse and keyboard, so you can keep
// working while they run. To watch the windows, run:  SMOKE_VISIBLE=1 pnpm smoke
if (process.env.SMOKE_VISIBLE !== '1') process.env.INSTANT_TEST_QUIET = '1'

export default defineConfig({ testDir: 'tests/smoke', timeout: 30_000, workers: 1 })
