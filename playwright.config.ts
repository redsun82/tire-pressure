import { defineConfig } from '@playwright/test';

/**
 * Pixel 10 Pro reference: 410×912 CSS px at DPR 3.125, portrait, Chrome.
 * Screenshots land in docs/screenshots/ (see screenshots/app.spec.ts).
 */
const pixel10Pro = {
  viewport: { width: 410, height: 912 },
  deviceScaleFactor: 3.125,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
};

// Not Vite's default preview port, so a preview of another checkout is never picked up by mistake.
const port = 4391;

export default defineConfig({
  testDir: 'screenshots',
  outputDir: 'test-results/screenshots',
  fullyParallel: true,
  reporter: 'list',
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/tire-pressure/`,
    // Always build and serve the current code: screenshots of a stale build are worse than none.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    ...pixel10Pro,
    baseURL: `http://localhost:${port}/tire-pressure/`,
    serviceWorkers: 'block',
    browserName: 'chromium',
  },
  projects: [
    { name: 'light', use: { colorScheme: 'light' } },
    { name: 'dark', use: { colorScheme: 'dark' } },
  ],
});
