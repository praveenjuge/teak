import { describe, expect, test } from "bun:test";
import { isLocalSelection, resolveWorkosMode } from "./setup-mode.ts";

const web = {
  deployment: undefined,
  deploymentApiBase: undefined,
  explicit: null,
  target: "web",
} as const;

describe("resolveWorkosMode", () => {
  test("a new web checkout uses the emulator", () => {
    expect(resolveWorkosMode(web)).toBe("emulator");
    expect(
      resolveWorkosMode({
        ...web,
        deployment: "anonymous:anonymous-agent",
        deploymentApiBase: "http://localhost:4320",
      })
    ).toBe("emulator");
  });

  test("a checkout already wired to staging keeps it", () => {
    expect(
      resolveWorkosMode({ ...web, deployment: "dev:happy-otter-123" })
    ).toBe("staging");
    expect(
      resolveWorkosMode({
        ...web,
        deployment: "anonymous:anonymous-agent",
        deploymentApiBase: "https://api.workos.com",
      })
    ).toBe("staging");
  });

  test("an explicit choice wins, except for E2E", () => {
    expect(resolveWorkosMode({ ...web, explicit: "staging" })).toBe("staging");
    expect(
      resolveWorkosMode({ ...web, target: "e2e", explicit: "staging" })
    ).toBe("emulator");
  });

  test("Connect surfaces use staging unless the backend uses the emulator", () => {
    expect(resolveWorkosMode({ ...web, target: "extension" })).toBe("staging");
    expect(
      resolveWorkosMode({
        ...web,
        target: "extension",
        deployment: "anonymous:anonymous-agent",
        deploymentApiBase: "http://localhost:4320",
      })
    ).toBe("emulator");
  });
});

describe("isLocalSelection", () => {
  test("no deployment and local backends are local", () => {
    expect(isLocalSelection(undefined)).toBe(true);
    expect(isLocalSelection("anonymous:anonymous-agent")).toBe(true);
    expect(isLocalSelection("local:teak")).toBe(true);
    expect(isLocalSelection("dev:happy-otter-123")).toBe(false);
  });
});
