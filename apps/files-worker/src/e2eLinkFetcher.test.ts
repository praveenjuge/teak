import { afterAll, describe, expect, test } from "bun:test";
import { e2eForwardTarget, FakeLinkFetcher } from "../e2e/fakeLinkFetcher";
import { checkLink } from "./linkCheck";
import { createContainerPinnedFetch } from "./media/pinnedHop";

const methods: string[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    methods.push(request.method);
    const { pathname } = new URL(request.url);
    const status = Number(/^\/status\/(\d{3})$/u.exec(pathname)?.[1] ?? 200);
    return new Response(request.method === "HEAD" ? null : "page", { status });
  },
});
afterAll(() => server.stop(true));

const ORIGIN = `http://1.1.1.1/teak-e2e-forward/${server.port}`;

/** The Worker's link fetcher binding, answered by the fake. */
const fakeNamespace = {
  get: () => new FakeLinkFetcher(),
  idFromName: (name: string) => name,
} as unknown as DurableObjectNamespace;

const check = (url: string) =>
  checkLink(
    { url },
    {
      hop: createContainerPinnedFetch({
        LINK_FETCHER: fakeNamespace,
        LINK_FETCHER_INSTANCES: "1",
      }),
      lookup: () => Promise.reject(new Error("an address needs no lookup")),
    }
  );

// The E2E stack's stand-in for the link fetcher Container
// (packages/tests/src/stack/filesWorker.ts binds it).
describe("the E2E link fetcher", () => {
  test("forwards only /teak-e2e-forward/<port> paths to that local port", () => {
    expect(e2eForwardTarget(`${ORIGIN}/status/404?x=1`)).toBe(
      `http://127.0.0.1:${server.port}/status/404?x=1`
    );
    expect(e2eForwardTarget("https://example.com/status/404")).toBeNull();
    expect(e2eForwardTarget("not a url")).toBeNull();
  });

  test("lets the real link check find a local 404 dead, with a HEAD", async () => {
    methods.length = 0;
    expect(await check(`${ORIGIN}/status/404`)).toEqual({
      httpStatus: 404,
      outcome: "dead",
      reason: "http_404",
    });
    expect(methods).toEqual(["HEAD"]);
  });

  test("answers like the missing Container for any other hop", async () => {
    expect(await check("http://1.1.1.1/status/404")).toEqual({
      outcome: "unsure",
      reason: "fetcher_unavailable",
    });
  });
});
