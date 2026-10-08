import { afterEach, describe, expect, test } from "bun:test";
import {
  isWorkosProductionApi,
  parseWorkosApiBase,
  workosIssuer,
} from "../../shared/workosApi";
import { createWorkosClient } from "../../shared/workosClient";

const originalBase = process.env.WORKOS_API_BASE_URL;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalBase === undefined) {
    delete process.env.WORKOS_API_BASE_URL;
  } else {
    process.env.WORKOS_API_BASE_URL = originalBase;
  }
  globalThis.fetch = originalFetch;
});

describe("WorkOS API base", () => {
  test("defaults to the production API", () => {
    expect(parseWorkosApiBase(undefined).href).toBe("https://api.workos.com/");
    expect(parseWorkosApiBase("https://api.workos.com").href).toBe(
      "https://api.workos.com/"
    );
    expect(isWorkosProductionApi(parseWorkosApiBase(undefined))).toBe(true);
  });

  test.each([
    "http://localhost:4100",
    "http://127.0.0.1:4100",
    "http://[::1]:4100",
    "https://localhost:8443",
  ])("accepts the loopback emulator at %s", (value: string) => {
    const base = parseWorkosApiBase(value);
    expect(base.origin).toBe(new URL(value).origin);
    expect(isWorkosProductionApi(base)).toBe(false);
  });

  test.each([
    "http://api.workos.com",
    "https://evil.example",
    "http://emulator.internal:4100",
    "http://10.0.0.5:4100",
    "http://localhost:4100/user_management",
    "http://localhost:4100/?next=x",
    "http://user:secret@localhost:4100",
    "ftp://localhost:4100",
    "not a url",
  ])("refuses %s", (value: string) => {
    expect(() => parseWorkosApiBase(value)).toThrow("WORKOS_API_BASE_URL");
  });

  test("keeps the production issuer whatever the API base", () => {
    process.env.WORKOS_API_BASE_URL = "http://localhost:4100";
    expect(workosIssuer("client_123")).toBe(
      "https://api.workos.com/user_management/client_123"
    );
  });
});

describe("createWorkosClient", () => {
  const requestedUrl = async () => {
    let requested = "";
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requested = input instanceof Request ? input.url : String(input);
      return Promise.resolve(
        Response.json({ message: "not found" }, { status: 404 })
      );
    }) as typeof fetch;
    await createWorkosClient("sk_test_default", "client_123")
      .userManagement.getUser("user_123")
      .catch(() => undefined);
    return new URL(requested);
  };

  test("calls the production API by default", async () => {
    delete process.env.WORKOS_API_BASE_URL;
    const url = await requestedUrl();
    expect(url.origin).toBe("https://api.workos.com");
    expect(url.pathname).toBe("/user_management/users/user_123");
  });

  test("calls the configured loopback emulator", async () => {
    process.env.WORKOS_API_BASE_URL = "http://localhost:4100";
    const url = await requestedUrl();
    expect(url.origin).toBe("http://localhost:4100");
    expect(url.pathname).toBe("/user_management/users/user_123");
  });
});
