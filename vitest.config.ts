import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import { existsSync } from 'node:fs'

// Use the system Chromium when present (CI images, sandboxes); otherwise let
// Playwright find its own download.
const chromium = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p))

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/node/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.ts'],
          testTimeout: 60_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: chromium ? { executablePath: chromium } : {} }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
