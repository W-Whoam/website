// @ts-check
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// Fully static: everything runs in the browser. Served by a Cloudflare Worker
// with static assets only (see wrangler.jsonc); no adapter needed.
export default defineConfig({
  site: 'https://who.ulus.me',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  integrations: [sitemap({ filter: (page) => !page.includes('/404') })],
  vite: {
    // Astro's default CSS target writes media queries as `(width<=560px)`,
    // which Safari before 16.4 ignores.
    build: { cssTarget: ['chrome87', 'safari14'] },
  },
});
