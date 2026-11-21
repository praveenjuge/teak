import { createFileRoute } from "@tanstack/react-router";
import { webManifest } from "@/lib/webManifest";

export const Route = createFileRoute("/manifest.webmanifest")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(webManifest()), {
          headers: {
            "Cache-Control": "public, max-age=0, must-revalidate",
            "Content-Type": "application/manifest+json",
          },
        }),
    },
  },
});
