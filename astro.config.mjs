// @ts-check
import { defineConfig } from 'astro/config';

// Fully static: everything runs in the browser, deployable to Cloudflare Pages as-is.
export default defineConfig({
  site: 'https://who.ulus.me',
  output: 'static',
});
