import { shareWorkerSource } from "./share/shareWorker";
import { webManifest } from "./webManifest";

/**
 * Files the installed app needs at fixed paths. vite.config.ts writes them
 * into the static assets at build time and serves them in development, so
 * they never run the Worker; public/_headers sets their headers. Relative
 * imports only, since vite.config.ts loads this without the `@/` alias.
 */
export const installFiles = [
  {
    path: "/manifest.webmanifest",
    contentType: "application/manifest+json",
    source: JSON.stringify(webManifest()),
  },
  {
    path: "/sw.js",
    contentType: "text/javascript; charset=utf-8",
    source: shareWorkerSource,
  },
] as const;
