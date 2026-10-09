import { describe, expect, test } from "bun:test";
import { stackUrls } from "../stack/config";
import { FIXTURE_URLS, resolveStackUrls } from "./env";

const running = {
  group: 2,
  logPath: "/tmp/stack.log",
  pid: 1,
  ports: { web: 4300, convex: 4310, convexSite: 4311, emulator: 4320 },
  ready: true,
  seeded: false,
  startedAt: "2026-10-09T00:00:00.000Z",
  urls: stackUrls({
    web: 4300,
    convex: 4310,
    convexSite: 4311,
    emulator: 4320,
  }),
};

describe("resolveStackUrls", () => {
  test("uses this checkout's running stack", () => {
    expect(resolveStackUrls(running, false).appOrigin).toBe(
      "http://localhost:4300"
    );
  });

  test("fails clearly when this checkout has no stack", () => {
    expect(() => resolveStackUrls(null, false)).toThrow(
      "No local stack is running for this checkout"
    );
  });

  test("hermetic suites never reach a real stack", () => {
    expect(resolveStackUrls(null, true)).toEqual(FIXTURE_URLS);
    expect(resolveStackUrls(running, true)).toEqual(FIXTURE_URLS);
  });
});
