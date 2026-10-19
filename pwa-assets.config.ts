import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// The source icon is full-bleed with the glyph inside the maskable safe zone,
// so no padding is needed for any of the generated icons.
const background = '#1f4fbf';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    transparent: { ...minimal2023Preset.transparent, padding: 0 },
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: { background } },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background } },
  },
  images: ['public/icon.svg'],
});
