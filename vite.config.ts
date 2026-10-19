import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Served from https://redsun82.github.io/tire-pressure/
  base: '/tire-pressure/',
  plugins: [
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
