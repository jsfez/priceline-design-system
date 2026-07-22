import { fileURLToPath } from 'node:url'

import { defineConfig } from '@playwright/test'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// The same static build `apps/storybook`'s `storybook:build` script produces,
// and the one the Chromatic step uploads.
const storybookDir = 'apps/docs/out/storybook'

// A dedicated port rather than Storybook's default, so a `storybook dev` left
// running on 8000 or 6006 is never mistaken for this build.
const port = process.env.ARGOS_PORT || '6104'

export default defineConfig({
  testDir: '.',
  testMatch: 'stories.spec.ts',
  timeout: 90_000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : 6,
  fullyParallel: true,
  reporter:
    process.env.ARGOS_TOKEN || process.env.CI ? [['list'], ['@argos-ci/playwright/reporter']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    contextOptions: { reducedMotion: 'reduce' },
    launchOptions: {
      // Subpixel text antialiasing is decided per glyph run and shifts a few
      // pixels between otherwise identical renders. Both flags are no-ops on
      // macOS, where headless Chromium never uses LCD text, so they only
      // matter on the CI runner.
      args: ['--disable-lcd-text', '--font-render-hinting=none'],
    },
  },
  webServer: {
    command: `node argos/serve.mjs ${storybookDir} ${port}`,
    // `cwd` is explicit because Playwright runs `command` from the folder
    // holding this config, and the Storybook build lives under the repo root.
    cwd: repoRoot,
    url: `http://127.0.0.1:${port}/iframe.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
