import { describe, expect, test } from "bun:test";
import {
  MediaRenderer,
  RENDERER_INACTIVITY_TIMEOUT_MS,
  type RendererContainer,
} from "./mediaRenderer";

const fakeContainer = (
  serve: (request: Request) => Response | Promise<Response>
) => {
  const events: unknown[] = [];
  let running = false;
  let healthChecks = 0;
  const container: RendererContainer = {
    getTcpPort: (port) => ({
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/health") {
          healthChecks += 1;
          if (healthChecks === 1) {
            throw new Error("connection refused");
          }
          return Response.json({ busy: false, ok: true, protocol: 1 });
        }
        events.push({ path: `${url.pathname}${url.search}`, port });
        return await serve(request);
      },
    }),
    monitor: () => new Promise<void>(() => undefined),
    get running() {
      return running;
    },
    setInactivityTimeout: (ms) => {
      events.push({ inactivityTimeout: ms });
      return Promise.resolve();
    },
    start: (options) => {
      events.push({ start: options });
      running = true;
    },
  };
  const state = {
    blockConcurrencyWhile: <T>(callback: () => Promise<T>) => callback(),
    container,
  };
  return { events, state };
};

describe("MediaRenderer", () => {
  test("starts the Container offline, waits for health, then forwards the job", async () => {
    const { events, state } = fakeContainer(
      async (request) =>
        new Response(`got ${(await request.arrayBuffer()).byteLength} bytes`)
    );
    const renderer = new MediaRenderer(state);
    const response = await renderer.fetch(
      new Request("http://renderer/video?frameMax=1600", {
        body: new Uint8Array(5),
        method: "POST",
      })
    );
    expect(await response.text()).toBe("got 5 bytes");
    expect(events).toEqual([
      { start: { enableInternet: false } },
      { inactivityTimeout: RENDERER_INACTIVITY_TIMEOUT_MS },
      { path: "/video?frameMax=1600", port: 8080 },
    ]);
  });

  test("starts the Container only once for later jobs", async () => {
    const { events, state } = fakeContainer(() => new Response("ok"));
    const renderer = new MediaRenderer(state);
    await renderer.fetch(
      new Request("http://renderer/probe", { method: "POST" })
    );
    await renderer.fetch(
      new Request("http://renderer/probe", { method: "POST" })
    );
    expect(events.filter((event) => "start" in (event as object))).toHaveLength(
      1
    );
  });

  test("answers 503 when no Container is configured", async () => {
    const renderer = new MediaRenderer({
      blockConcurrencyWhile: (callback) => callback(),
    });
    const response = await renderer.fetch(new Request("http://renderer/probe"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "unavailable",
      message: "container_missing",
    });
  });

  test("answers 503 when the Container drops the request", async () => {
    const { state } = fakeContainer(() => {
      throw new Error("container exited");
    });
    const response = await new MediaRenderer(state).fetch(
      new Request("http://renderer/probe", { method: "POST" })
    );
    expect(response.status).toBe(503);
  });
});
