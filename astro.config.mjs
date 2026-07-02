import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    mode: 'directory',
    functionPerRoute: true,
  }),
  integrations: [
    vue(),
  ],
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      external: ['node:crypto', 'node:path'],
    },
  },
});
