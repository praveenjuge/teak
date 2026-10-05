import { afterEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { readAuthMode } = await import("../lib/auth-mode-server");
const originalUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const servers: ReturnType<typeof Bun.serve>[] = [];
const mode = {
  primary: "betterauth",
  signupsDisabled: true,
  accountChangesPaused: false,
};

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
  if (originalUrl === undefined) {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
  } else {
    process.env.NEXT_PUBLIC_CONVEX_URL = originalUrl;
  }
});

// Failure modes: bypassing the configured backend, following a redirect to a
// different service, or losing the real Convex query serialization/validation.
test("reads authentication mode through the configured Convex query endpoint", async () => {
  let received: unknown;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      expect(new URL(request.url).pathname).toBe("/api/query");
      expect(request.method).toBe("POST");
      received = await request.json();
      return Response.json({ status: "success", value: mode });
    },
  });
  servers.push(server);
  process.env.NEXT_PUBLIC_CONVEX_URL = server.url.origin;
  expect(await readAuthMode()).toEqual(mode);
  expect(received).toMatchObject({ path: "auth:getAuthMode", args: [{}] });
});

test("rejects a backend redirect without contacting its destination", async () => {
  let destinationRequests = 0;
  const destination = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      destinationRequests++;
      return Response.json({ status: "success", value: mode });
    },
  });
  const backend = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.redirect(destination.url, 302),
  });
  servers.push(destination, backend);
  process.env.NEXT_PUBLIC_CONVEX_URL = backend.url.origin;
  await expect(readAuthMode()).rejects.toThrow();
  expect(destinationRequests).toBe(0);
});
