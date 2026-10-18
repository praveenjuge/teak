import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createFetcherHandler } from "./handler";
import { nodeDnsResolver, pinnedFetch } from "./pinnedFetch";
import { FETCHER_PORT } from "./protocol";

const handle = createFetcherHandler({
  pinnedFetch,
  resolveDns: nodeDnsResolver,
});

const MAX_BODY_BYTES = 64 * 1024;

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of incoming) {
      total += (chunk as Buffer).byteLength;
      if (total > MAX_BODY_BYTES) {
        outgoing.writeHead(413, { "content-type": "application/json" });
        outgoing.end(JSON.stringify({ error: "invalid_request" }));
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const request = new Request(`http://fetcher${incoming.url ?? "/"}`, {
      method: incoming.method,
      ...(incoming.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
    });
    const response = await handle(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      // pipeline, unlike pipe, cancels the body when the Worker hangs up, so
      // a streamed hop gives back its slot.
      await pipeline(Readable.fromWeb(response.body as never), outgoing).catch(
        () => undefined
      );
    } else {
      outgoing.end();
    }
  } catch (error) {
    console.error("fetcher.request_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    if (!outgoing.headersSent) {
      outgoing.writeHead(500, { "content-type": "application/json" });
    }
    outgoing.end(JSON.stringify({ error: "internal" }));
  }
});

server.listen(Number(process.env.PORT) || FETCHER_PORT, "0.0.0.0");
