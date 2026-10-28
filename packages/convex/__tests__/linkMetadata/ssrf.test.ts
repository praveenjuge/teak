import { afterEach, describe, expect, test } from "bun:test";
import {
  assertUrlIsSafe,
  assertUrlStructureSafe,
  type DnsResolver,
  detectIpVersion,
  isBlockedIp,
  RedirectError,
  readBodyWithLimit,
  SsrfError,
  safeFetch,
} from "../../../convex/linkMetadata/ssrf";

const resolveTo =
  (...addresses: string[]): DnsResolver =>
  async () =>
    addresses;
const resolveFails: DnsResolver = () => {
  throw new Error("dns failure");
};
const resolveEmpty: DnsResolver = async () => [];
const resolveUnused: DnsResolver = () => {
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
    expect(isBlockedIp("172.32.0.1")).toBe(false);
    expect(isBlockedIp("11.0.0.1")).toBe(false);
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

  test("blocks IPv6 forms that tunnel to an embedded IPv4", () => {
    // IPv4-compatible, 6to4 and Teredo all carry an IPv4 the host can reach.
    expect(isBlockedIp("::127.0.0.1")).toBe(true);
    expect(isBlockedIp("::a9fe:a9fe")).toBe(true);
    expect(isBlockedIp("2002:7f00:1::1")).toBe(true);
    expect(isBlockedIp("2001:0:4136:e378:8000:63bf:3fff:fdd2")).toBe(true);
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
    globalThis.fetch = (() => {
      called = true;
      return Promise.resolve(new Response("nope"));
    }) as unknown as typeof fetch;

    await expect(
      safeFetch("http://127.0.0.1", resolveUnused)
    ).rejects.toBeInstanceOf(SsrfError);
    expect(called).toBe(false);
  });

  test("re-validates redirect hops and blocks internal redirects", async () => {
    const requested: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const target = typeof input === "string" ? input : input.toString();
      requested.push(target);
      return Promise.resolve(
        Response.redirect("http://169.254.169.254/latest/meta-data", 302)
      );
    }) as typeof fetch;

    await expect(
      safeFetch("https://8.8.8.8/start", resolveUnused)
    ).rejects.toBeInstanceOf(SsrfError);
    expect(requested).toEqual(["https://8.8.8.8/start"]);
  });

  test("returns the response for an allowed destination", async () => {
    globalThis.fetch = (async () =>
      new Response("ok", { status: 200 })) as unknown as typeof fetch;

    const { finalUrl, response } = await safeFetch(
      "https://8.8.8.8/data",
      resolveUnused
    );
    expect(finalUrl).toBe("https://8.8.8.8/data");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  test("a caller's hop limit replaces the 30 second one, body included", async () => {
    const signals: AbortSignal[] = [];
    const pinned = (_url: string, _addresses: string[], init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return Promise.resolve(new Response("ok"));
    };

    await safeFetch("https://8.8.8.8/a", resolveUnused, {}, pinned, 0, 20);
    await safeFetch("https://8.8.8.8/b", resolveUnused, {}, pinned, 0);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
  });

  test("reports the URL of the hop that answered after redirects", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) =>
      Promise.resolve(
        String(input) === "https://8.8.8.8/start"
          ? new Response(null, { headers: { location: "/end" }, status: 301 })
          : new Response("ok")
      )) as typeof fetch;

    const { finalUrl } = await safeFetch(
      "https://8.8.8.8/start",
      resolveUnused
    );
    expect(finalUrl).toBe("https://8.8.8.8/end");
  });

  test("fails a redirect loop as a redirect error, not a refused URL", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, { headers: { location: "/again" }, status: 302 })
      )) as unknown as typeof fetch;

    const error = await safeFetch("https://8.8.8.8/start", resolveUnused).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(RedirectError);
    expect((error as RedirectError).reason).toBe("too_many_redirects");
  });

  test("a caller can allow a longer redirect chain, every hop still checked", async () => {
    // Six tracking hops, as podcast hosts stack in front of an episode.
    const chain = (requests: string[]) =>
      ((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requests.push(url.pathname);
        const hop = Number(url.pathname.slice("/hop".length) || 0);
        return Promise.resolve(
          hop < 6
            ? new Response(null, {
                headers: { location: `/hop${hop + 1}` },
                status: 302,
              })
            : new Response("audio")
        );
      }) as typeof fetch;

    const refused: string[] = [];
    globalThis.fetch = chain(refused);
    const error = await safeFetch("https://8.8.8.8/hop0", resolveUnused).catch(
      (caught: unknown) => caught
    );
    expect((error as RedirectError).reason).toBe("too_many_redirects");
    expect(refused).toHaveLength(6);

    const followed: string[] = [];
    globalThis.fetch = chain(followed);
    const { finalUrl, response } = await safeFetch(
      "https://8.8.8.8/hop0",
      resolveUnused,
      {},
      undefined,
      8
    );
    expect(finalUrl).toBe("https://8.8.8.8/hop6");
    expect(await response.text()).toBe("audio");
    expect(followed).toHaveLength(7);
  });

  test("passes only validated DNS addresses to the connection", async () => {
    const pinned = (url: string, addresses: string[], init: RequestInit) => {
      expect(url).toBe("https://example.com/");
      expect(addresses).toEqual(["93.184.216.34"]);
      expect(init.redirect).toBe("manual");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(new Response("ok"));
    };

    const { response } = await safeFetch(
      "https://example.com/",
      resolveTo("93.184.216.34"),
      {},
      pinned
    );
    expect(await response.text()).toBe("ok");
  });
});

describe("readBodyWithLimit", () => {
  test("reads a response at the byte limit", async () => {
    const bytes = await readBodyWithLimit(new Response("abcd"), 4);
    expect(new TextDecoder().decode(bytes)).toBe("abcd");
  });

  test("cancels and rejects a streamed response over the byte limit", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
        start(controller) {
          controller.enqueue(new TextEncoder().encode("abc"));
          controller.enqueue(new TextEncoder().encode("def"));
        },
      })
    );

    await expect(readBodyWithLimit(response, 4)).rejects.toThrow(
      "body_too_large"
    );
    expect(cancelled).toBe(true);
  });
});
