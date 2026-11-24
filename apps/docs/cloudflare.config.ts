import { defineConfig } from "cf/config";

// teakvault.com is a static Blume build served as Workers static assets, plus
// worker.ts, which answers `Accept: text/markdown`. `bun run deploy` runs
// Wrangler with wrangler.jsonc, because `cf deploy dist` refuses a project
// that has a Worker entrypoint. This file is for `cf` commands that need only
// the assets. `dist/` has the `_headers` and `_redirects` Cloudflare reads. The Core Worker's routes on teakvault.com
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
