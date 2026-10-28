import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Content Security Policy of the built app. GitHub Pages can't send headers, so it is a <meta> tag,
 * where `frame-ancestors`, `report-uri` and `sandbox` are ignored. Scripts and styles come only from
 * the app itself, and the page can only talk to Shelly Cloud (the key must never go elsewhere) and
 * Open-Meteo. `img-src data:` is for small images Vite may inline.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://*.shelly.cloud https://api.open-meteo.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** Adds the CSP to the production build only: the dev server needs inline scripts for HMR. */
function contentSecurityPolicy(): Plugin {
  const charset = '<meta charset="UTF-8" />';
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      // Right after the charset, so it applies to every script and stylesheet that follows.
      if (!html.includes(charset)) throw new Error(`index.html has no ${charset} to put the CSP after`);
      return html.replace(charset, `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`);
    },
  };
}

export default defineConfig({
  // Served from https://redsun82.github.io/tire-pressure/
  base: '/tire-pressure/',
  plugins: [
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'autoUpdate',
      pwaAssets: {
        config: true,
        overrideManifestIcons: true,
        // index.html carries light/dark theme-color metas itself.
        injectThemeColor: false,
      },
      manifest: {
        id: '/tire-pressure/',
        name: 'Tire Pressure',
        short_name: 'Tire PSI',
        description: 'Bike tire pressure calculator for the whole family. Works offline.',
        lang: 'en',
        start_url: '/tire-pressure/',
        scope: '/tire-pressure/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#f3f5f9',
        background_color: '#f3f5f9',
        categories: ['sports', 'utilities'],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
