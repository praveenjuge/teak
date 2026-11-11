import { MAX_REQUEST_BYTES } from "./handler";

const json = (status: number, body: unknown): Response =>
  Response.json(body, { status });

/**
 * Serves the fetcher's handler. Each request keeps its own clock (a streamed
 * hop runs for minutes), so Bun's idle timeout is off; when the Worker hangs
 * up, Bun cancels the response body, which gives back a streamed hop's slot.
 */
export const serveFetcher = (
  handle: (request: Request) => Promise<Response>,
  port: number,
  hostname = "0.0.0.0"
) =>
  Bun.serve({
    async fetch(request, server) {
      server.timeout(request, 0);
      try {
        const body = await request.arrayBuffer();
        return await handle(
          new Request(request.url, {
            method: request.method,
            ...(request.method === "POST" ? { body } : {}),
          })
        );
      } catch (error) {
        console.error("fetcher.request_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        return json(500, { error: "internal" });
      }
    },
    hostname,
    // The handler's cap answers in JSON; this only stops Bun buffering a body
    // far past it.
    maxRequestBodySize: MAX_REQUEST_BYTES * 2,
    port,
  });
