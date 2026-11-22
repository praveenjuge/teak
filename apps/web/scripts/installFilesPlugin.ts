import type { Plugin } from "vite";
import { installFiles } from "../src/lib/installFiles.ts";

// The web app manifest and the share service worker, written as static files
// so they are served from the edge without running the Worker.
export function installFilesPlugin(): Plugin {
  return {
    name: "teak:install-files",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = installFiles.find(
          ({ path }) => path === request.url?.split("?")[0]
        );
        if (!file) {
          next();
          return;
        }
        response.setHeader("Content-Type", file.contentType);
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Service-Worker-Allowed", "/");
        response.end(file.source);
      });
    },
    generateBundle() {
      if (this.environment.name !== "client") {
        return;
      }
      for (const { path, source } of installFiles) {
        this.emitFile({ type: "asset", fileName: path.slice(1), source });
      }
    },
  };
}
