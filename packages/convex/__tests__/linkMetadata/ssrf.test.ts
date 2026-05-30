import { afterEach, describe, expect, test } from "bun:test";
import {
  assertUrlIsSafe,
  assertUrlStructureSafe,
  type DnsResolver,
  detectIpVersion,
  isBlockedIp,
  SsrfError,
  safeFetch,
} from "../../../convex/linkMetadata/ssrf";

// Deterministic, offline DNS resolvers for injection.
const resolveTo =
  (...addresses: string[]): DnsResolver =>
  async () =>
    addresses;
const resolveFails: DnsResolver = async () => {
  throw new Error("dns failure");
};
const resolveEmpty: DnsResolver = async () => [];
// Default resolver for tests that should never trigger DNS (literal IP hosts).
const resolveUnused: DnsResolver = async () => {
  throw new Error("DNS resolver should not have been called");
};

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

describe("detectIpVersion", () => {
  test("detects IPv4 literals", () => {
    expect(detectIpVersion("8.8.8.8")).toBe(4);
    expect(detectIpVersion("127.0.0.1")).toBe(4);
  });

  test("detects IPv6 literals", () => {
    expect(detectIpVersion("::1")).toBe(6);
    expect(detectIpVersion("2606:4700:4700::1111")).toBe(6);
    expect(detectIpVersion("::ffff:127.0.0.1")).toBe(6);
  });

  test("returns 0 for hostnames and malformed literals", () => {
    expect(detectIpVersion("example.com")).toBe(0);
    expect(detectIpVersion("localhost")).toBe(0);
    expect(detectIpVersion("999.999.999.999")).toBe(0);
    expect(detectIpVersion("")).toBe(0);
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
    const url = await assertUrlIsSafe("https://8.8.8.8/path", resolveUnused);
    expect(url.hostname).toBe("8.8.8.8");
  });

  test("rejects literal private IPs", async () => {
    await expect(
      assertUrlIsSafe("http://10.0.0.1", resolveUnused)
    ).rejects.toBeInstanceOf(SsrfError);
  });

  test("allows hostnames that resolve to a public address", async () => {
    const url = await assertUrlIsSafe(
      "https://example.com",
      resolveTo("93.184.216.34")
    );
    expect(url.hostname).toBe("example.com");
  });

  test("rejects hostnames that resolve to loopback or private space", async () => {
    await expect(
      assertUrlIsSafe("http://internal.example.com", resolveTo("127.0.0.1"))
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      assertUrlIsSafe("http://internal.example.com", resolveTo("10.0.0.5"))
    ).rejects.toBeInstanceOf(SsrfError);
  });

  test("rejects when any resolved address is private (DNS rebinding)", async () => {
    await expect(
      assertUrlIsSafe(
        "http://rebind.example.com",
        resolveTo("93.184.216.34", "169.254.169.254")
      )
    ).rejects.toBeInstanceOf(SsrfError);
  });

  test("treats DNS failure and empty resolution as blocked", async () => {
    await expect(
      assertUrlIsSafe("http://nope.example.com", resolveFails)
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      assertUrlIsSafe("http://nope.example.com", resolveEmpty)
    ).rejects.toBeInstanceOf(SsrfError);
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

    await expect(
      safeFetch("http://127.0.0.1", resolveUnused)
    ).rejects.toBeInstanceOf(SsrfError);
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

    await expect(
      safeFetch("https://8.8.8.8/start", resolveUnused)
    ).rejects.toBeInstanceOf(SsrfError);
    // The internal redirect target must never be requested.
    expect(requested).toEqual(["https://8.8.8.8/start"]);
  });

  test("returns the response for an allowed destination", async () => {
    globalThis.fetch = (async () =>
      new Response("ok", { status: 200 })) as typeof fetch;

    const response = await safeFetch("https://8.8.8.8/data", resolveUnused);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});
