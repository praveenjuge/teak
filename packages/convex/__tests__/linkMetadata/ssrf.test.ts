import { afterEach, describe, expect, test } from "bun:test";
import {
  assertUrlIsSafe,
  assertUrlStructureSafe,
  isBlockedIp,
  SsrfError,
  safeFetch,
} from "../../../convex/linkMetadata/ssrf";

describe("isBlockedIp", () => {
  test("blocks IPv4 loopback", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.255.255.254")).toBe(true);
  });

  test("blocks IPv4 private ranges", () => {
    expect(isBlockedIp("10.0.0.5")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });

  test("blocks IPv4 link-local and metadata service", () => {
    expect(isBlockedIp("169.254.0.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
  });

  test("blocks IPv4 carrier-grade NAT, unspecified, broadcast", () => {
    expect(isBlockedIp("100.64.0.1")).toBe(true);
    expect(isBlockedIp("0.0.0.0")).toBe(true);
    expect(isBlockedIp("255.255.255.255")).toBe(true);
  });

  test("allows public IPv4 addresses", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
    expect(isBlockedIp("172.32.0.1")).toBe(false); // just outside 172.16/12
    expect(isBlockedIp("11.0.0.1")).toBe(false); // just outside 10/8
  });

  test("blocks IPv6 loopback, unspecified, unique-local, link-local", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("::")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
  });

  test("blocks IPv4-mapped IPv6 pointing at private space", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true);
  });

  test("allows public IPv6 addresses", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("2001:4860:4860::8888")).toBe(false);
  });

  test("treats non-IP literals as unsafe", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("999.999.999.999")).toBe(true);
  });
});

describe("assertUrlStructureSafe", () => {
  test("accepts plain https/http urls", () => {
    expect(assertUrlStructureSafe("https://example.com").hostname).toBe(
      "example.com"
    );
    expect(assertUrlStructureSafe("http://example.com:80/path").port).toBe("");
    expect(assertUrlStructureSafe("https://example.com:443").port).toBe("");
  });

  test("rejects non-http(s) protocols", () => {
    expect(() => assertUrlStructureSafe("file:///etc/passwd")).toThrow(
      SsrfError
    );
    expect(() => assertUrlStructureSafe("ftp://example.com")).toThrow(
      SsrfError
    );
    expect(() => assertUrlStructureSafe("gopher://example.com")).toThrow(
      SsrfError
    );
  });

  test("rejects embedded credentials", () => {
    expect(() =>
      assertUrlStructureSafe("https://user:pass@example.com")
    ).toThrow(SsrfError);
  });

  test("rejects non-standard ports", () => {
    expect(() => assertUrlStructureSafe("http://example.com:8080")).toThrow(
      SsrfError
    );
    expect(() => assertUrlStructureSafe("https://example.com:22")).toThrow(
      SsrfError
    );
  });

  test("rejects literal private/loopback IP hosts without DNS", () => {
    expect(() => assertUrlStructureSafe("http://127.0.0.1")).toThrow(SsrfError);
    expect(() =>
      assertUrlStructureSafe("http://169.254.169.254/latest/meta-data")
    ).toThrow(SsrfError);
    expect(() => assertUrlStructureSafe("http://[::1]")).toThrow(SsrfError);
  });

  test("allows literal public IP hosts", () => {
    expect(assertUrlStructureSafe("https://8.8.8.8").hostname).toBe("8.8.8.8");
  });

  test("exposes a machine-readable reason", () => {
    try {
      assertUrlStructureSafe("file:///etc/passwd");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SsrfError);
      expect((error as SsrfError).reason).toBe("blocked_protocol");
    }
  });
});

describe("assertUrlIsSafe", () => {
  test("resolves literal public IPs without DNS", async () => {
    const url = await assertUrlIsSafe("https://8.8.8.8/path");
    expect(url.hostname).toBe("8.8.8.8");
  });

  test("rejects literal private IPs", async () => {
    await expect(assertUrlIsSafe("http://10.0.0.1")).rejects.toBeInstanceOf(
      SsrfError
    );
  });

  test("rejects hostnames that resolve to loopback", async () => {
    // localhost resolves via the hosts file (offline + deterministic).
    await expect(assertUrlIsSafe("http://localhost")).rejects.toBeInstanceOf(
      SsrfError
    );
  });
});

describe("safeFetch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("blocks the request before fetch when the target is private", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("nope");
    }) as typeof fetch;

    await expect(safeFetch("http://127.0.0.1")).rejects.toBeInstanceOf(
      SsrfError
    );
    expect(called).toBe(false);
  });

  test("re-validates redirect hops and blocks internal redirects", async () => {
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const target = typeof input === "string" ? input : input.toString();
      requested.push(target);
      // First public hop redirects to a private address.
      return Response.redirect("http://169.254.169.254/latest/meta-data", 302);
    }) as typeof fetch;

    await expect(safeFetch("https://8.8.8.8/start")).rejects.toBeInstanceOf(
      SsrfError
    );
    // The internal redirect target must never be requested.
    expect(requested).toEqual(["https://8.8.8.8/start"]);
  });

  test("returns the response for an allowed destination", async () => {
    globalThis.fetch = (async () =>
      new Response("ok", { status: 200 })) as typeof fetch;

    const response = await safeFetch("https://8.8.8.8/data");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});
