import { describe, expect, test } from "bun:test";
import { serveFetcher } from "./serve";

const withServer = async (
  handle: (request: Request) => Promise<Response>,
  body: (base: string) => Promise<void>
) => {
  const server = serveFetcher(handle, 0, "127.0.0.1");
  try {
    await body(`http://127.0.0.1:${server.port}`);
  } finally {
    server.stop(true);
  }
};

describe("serveFetcher", () => {
  test("passes the method, path and body to the handler", async () => {
    await withServer(
      async (request) =>
        Response.json({
          body: await request.text(),
          method: request.method,
          path: new URL(request.url).pathname,
        }),
      async (base) => {
        const response = await fetch(`${base}/hop`, {
          body: '{"a":1}',
          method: "POST",
        });
        expect(await response.json()).toEqual({
          body: '{"a":1}',
          method: "POST",
          path: "/hop",
        });
      }
    );
  });

  test("refuses a request body over 64 KiB", async () => {
    let called = false;
    await withServer(
      () => {
        called = true;
        return Promise.resolve(new Response("ok"));
      },
      async (base) => {
        const response = await fetch(`${base}/fetch`, {
          body: "x".repeat(64 * 1024 + 1),
          method: "POST",
        });
        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({ error: "invalid_request" });
      }
    );
    expect(called).toBe(false);
  });

  test("answers 500 when the handler throws", async () => {
    await withServer(
      () => Promise.reject(new Error("boom")),
      async (base) => {
        const response = await fetch(`${base}/health`);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "internal" });
      }
    );
  });

  test("cancels a streamed body when the client hangs up", async () => {
    const { promise: cancelled, resolve } = Promise.withResolvers<void>();
    await withServer(
      () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              cancel: () => resolve(),
              pull: async (controller) => {
                await Bun.sleep(10);
                controller.enqueue(new Uint8Array(1024));
              },
            })
          )
        ),
      async (base) => {
        const controller = new AbortController();
        const response = await fetch(`${base}/hop-stream`, {
          method: "POST",
          signal: controller.signal,
        });
        const reader = (
          response.body as ReadableStream<Uint8Array>
        ).getReader();
        await reader.read();
        controller.abort();
        await cancelled;
      }
    );
  });
});
