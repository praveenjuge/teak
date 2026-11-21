import { createFileRoute } from "@tanstack/react-router";
import { shareWorkerSource } from "@/lib/share/shareWorker";

// Served from the root so the worker's scope is the whole app.
export const Route = createFileRoute("/sw.js")({
  server: {
    handlers: {
      GET: () =>
        new Response(shareWorkerSource, {
          headers: {
            "Cache-Control": "no-cache",
            "Content-Type": "text/javascript; charset=utf-8",
            "Service-Worker-Allowed": "/",
          },
        }),
    },
  },
});
