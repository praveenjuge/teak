import { shareWorkerSource } from "@/lib/share/shareWorker";

// Served from the root so the worker's scope is the whole app.
export function GET() {
  return new Response(shareWorkerSource, {
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "text/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
    },
  });
}
