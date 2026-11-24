import { bindings, defineConfig } from "cf/config";

// teakvault.com is a static Blume build served as Workers static assets.
// worker.ts runs before the assets only to answer `Accept: text/markdown`
// requests from each page's .md twin; everything else is served as before.
// `bun run deploy` uploads `dist/`, whose `_headers` and `_redirects`
// Cloudflare reads. The Core Worker's routes on teakvault.com (/api, /mcp
// and its two /.well-known files) run before this Custom Domain.
export default defineConfig({
  worker: {
    name: "teak-site",
    compatibilityDate: "2026-10-15",
    entrypoint: "./worker.ts",
    assets: {
      // Blume writes each page as <route>/index.html and links to it without
      // a trailing slash; the default would 307 /docs to /docs/.
      htmlHandling: "drop-trailing-slash",
      notFoundHandling: "404-page",
      runWorkerFirst: true,
    },
    env: {
      ASSETS: bindings.assets(),
    },
    domains: ["teakvault.com", "www.teakvault.com"],
    workersDev: false,
  },
});
