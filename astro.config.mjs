import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

const isVueUsePureAnnotationWarning = (log) => {
  if (typeof log === 'string') {
    return false;
  }

  return log.code === 'INVALID_ANNOTATION' && log.message?.includes('@vueuse/core/dist/index.js');
};

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    configPath: './wrangler.template.jsonc',
    mode: 'directory',
    functionPerRoute: true,
  }),
  integrations: [
    vue(),
  ],
  vite: {
    plugins: [tailwindcss()],
    build: {
      rolldownOptions: {
        onLog(level, log, handler) {
          if (level === 'warn' && isVueUsePureAnnotationWarning(log)) {
            return;
          }

          handler(level, log);
        },
      },
    },
    ssr: {
      external: ['node:crypto', 'node:path'],
    },
  },
});
