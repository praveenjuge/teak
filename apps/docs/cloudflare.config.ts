import { defineConfig } from "cf/config";

// teakvault.com is a static Blume build served as Workers static assets, with
// no Worker code. `bun run deploy` uploads `dist/`, whose `_headers` and
// `_redirects` Cloudflare reads. The Core Worker's routes on teakvault.com
// (/api, /mcp and its two /.well-known files) run before this Custom Domain.
export default defineConfig({
  worker: {
    name: "teak-site",
    compatibilityDate: "2026-10-15",
    assets: {
      // Blume writes each page as <route>/index.html and links to it without
      // a trailing slash; the default would 307 /docs to /docs/.
      htmlHandling: "drop-trailing-slash",
      notFoundHandling: "404-page",
    },
    domains: ["teakvault.com", "www.teakvault.com"],
    workersDev: false,
  },
});
