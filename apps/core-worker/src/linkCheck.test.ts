import { describe, expect, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  FILES_PROTOCOL_VERSION,
  type FilesLinkCheckResult,
} from "@teak/files-protocol";
import { hmacSha256Hex, sha256Hex } from "./lib";
import {
  checkLink,
  createDohLookup,
  type DnsAnswer,
  type DnsLookup,
} from "./linkCheck";
import { createContainerPinnedFetch } from "./media/pinnedHop";
import { type FilesOpsEnv, handleInternalOp } from "./ops";
import { createContainerNetwork } from "./test/cardProcessingKit";

const PUBLIC = "93.184.216.34";
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";

/** Names map to their A and AAAA answers; anything else is NXDOMAIN. */
const dns = (
  records: Record<
    string,
    Partial<Record<"A" | "AAAA", DnsAnswer | "throw">> | undefined
  >
): DnsLookup & { queries: string[] } => {
  const queries: string[] = [];
  const lookup: DnsLookup = (hostname, type) => {
    queries.push(`${hostname} ${type}`);
    const answer = records[hostname]?.[type] ?? { addresses: [], status: 3 };
    return answer === "throw"
      ? Promise.reject(new Error("doh_unavailable"))
      : Promise.resolve(answer);
  };
  return Object.assign(lookup, { queries });
};

const resolves = (address = PUBLIC) => ({
  A: { addresses: [address], status: 0 },
  AAAA: { addresses: [], status: 0 },
});

interface Upstream {
  method: string;
  url: string;
}

/**
 * The real fetcher handler behind the Container hop, with `route` standing
 * in for the internet.
 */
const network = (
  route: (url: string, method: string) => Response | undefined
) => {
  const seen: Upstream[] = [];
  const container = createContainerNetwork((url, init) => {
    const method = init.method ?? "GET";
    seen.push({ method, url });
    return route(url, method);
  });
  return {
    hop: createContainerPinnedFetch(container.env, { maxBytes: 1 }),
    seen,
  };
};

const check = (
  url: string,
  route: (url: string, method: string) => Response | undefined,
  lookup: DnsLookup = dns({ "example.com": resolves() })
) => {
  const net = network(route);
  return {
    result: checkLink({ url }, { hop: net.hop, lookup }),
    seen: net.seen,
  };
};

const status = (code: number) => () =>
  new Response(code === 204 ? null : "body", { status: code });

describe("check-link status table", () => {
  test.each([
    [200, { httpStatus: 200, outcome: "alive", reason: "ok" }],
    [204, { httpStatus: 204, outcome: "alive", reason: "ok" }],
    [404, { httpStatus: 404, outcome: "dead", reason: "http_404" }],
    [410, { httpStatus: 410, outcome: "dead", reason: "http_410" }],
    [401, { httpStatus: 401, outcome: "unsure", reason: "http_status" }],
    [403, { httpStatus: 403, outcome: "unsure", reason: "http_status" }],
    [429, { httpStatus: 429, outcome: "unsure", reason: "http_status" }],
    [500, { httpStatus: 500, outcome: "unsure", reason: "http_status" }],
    [503, { httpStatus: 503, outcome: "unsure", reason: "http_status" }],
  ] as const)("HTTP %d is %o", async (code, expected) => {
    const { result, seen } = check("https://example.com/page", status(code));
    expect(await result).toEqual(expected as FilesLinkCheckResult);
    expect(seen).toEqual([{ method: "HEAD", url: "https://example.com/page" }]);
  });
});

describe("check-link redirects", () => {
  test("a 404 three redirects away is dead", async () => {
    const { result, seen } = check("https://example.com/a", (url) => {
      const path = new URL(url).pathname;
      const next = { "/a": "/b", "/b": "/c", "/c": "/gone" }[path];
      return next
        ? new Response(null, { headers: { location: next }, status: 301 })
        : new Response(null, { status: 404 });
    });
    expect(await result).toEqual({
      httpStatus: 404,
      outcome: "dead",
      reason: "http_404",
    });
    expect(seen.map((hop) => new URL(hop.url).pathname)).toEqual([
      "/a",
      "/b",
      "/c",
      "/gone",
    ]);
  });

  test("follows five redirects and gives up on the sixth", async () => {
    const { result, seen } = check(
      "https://example.com/0",
      (url) =>
        new Response(null, {
          headers: {
            location: `/${Number(new URL(url).pathname.slice(1)) + 1}`,
          },
          status: 302,
        })
    );
    expect(await result).toEqual({
      httpStatus: 302,
      outcome: "unsure",
      reason: "redirects",
    });
    expect(seen).toHaveLength(6);
  });

  test("a redirect loop is unsure, never dead", async () => {
    const { result } = check(
      "https://example.com/loop",
      () => new Response(null, { headers: { location: "/loop" }, status: 307 })
    );
    expect((await result).outcome).toBe("unsure");
  });

  test.each([
    ["a private address", "http://10.0.0.7/admin"],
    ["the metadata address", "http://169.254.169.254/latest"],
    ["a non-web port", "https://example.com:8443/x"],
  ])(
    "a redirect to %s is unsure and never requested",
    async (_name, location) => {
      const { result, seen } = check("https://example.com/r", () =>
        Response.redirect(location, 302)
      );
      expect(await result).toEqual({ outcome: "unsure", reason: "blocked" });
      expect(seen).toHaveLength(1);
    }
  );

  test("a redirect to a host that resolves to a private address is unsure", async () => {
    const { result, seen } = check(
      "https://example.com/r",
      () => Response.redirect("https://internal.example/", 302),
      dns({
        "example.com": resolves(),
        "internal.example": resolves("10.1.2.3"),
      })
    );
    expect(await result).toEqual({ outcome: "unsure", reason: "blocked" });
    expect(seen).toHaveLength(1);
  });

  test("checks each redirect's host again, and a redirect to a gone domain is dead", async () => {
    const lookup = dns({ "example.com": resolves() });
    const { result } = check(
      "https://example.com/moved",
      () => Response.redirect("https://gone.example/", 301),
      lookup
    );
    expect(await result).toEqual({ outcome: "dead", reason: "dns" });
    expect(lookup.queries.sort()).toEqual([
      "example.com A",
      "example.com AAAA",
      "gone.example A",
      "gone.example AAAA",
    ]);
  });
});

describe("check-link DNS", () => {
  test("a domain whose A and AAAA both answer NXDOMAIN is dead, without a request", async () => {
    const { result, seen } = check(
      "https://no-longer-here.example/",
      status(200),
      dns({})
    );
    expect(await result).toEqual({ outcome: "dead", reason: "dns" });
    expect(seen).toEqual([]);
  });

  test.each([
    [
      "SERVFAIL",
      {
        A: { addresses: [], status: 2 },
        AAAA: { addresses: [], status: 2 },
      },
    ],
    [
      "NXDOMAIN beside SERVFAIL",
      {
        A: { addresses: [], status: 3 },
        AAAA: { addresses: [], status: 2 },
      },
    ],
    [
      "NXDOMAIN beside a failed lookup",
      { A: { addresses: [], status: 3 }, AAAA: "throw" as const },
    ],
    ["two failed lookups", { A: "throw" as const, AAAA: "throw" as const }],
    [
      "an empty NOERROR answer",
      {
        A: { addresses: [], status: 0 },
        AAAA: { addresses: [], status: 0 },
      },
    ],
  ])("%s is unsure", async (_name, records) => {
    const { result, seen } = check(
      "https://flaky.example/",
      status(404),
      dns({ "flaky.example": records })
    );
    expect(await result).toEqual({ outcome: "unsure", reason: "dns_error" });
    expect(seen).toEqual([]);
  });

  test("an IPv6-only host is checked at its address", async () => {
    const { result, seen } = check(
      "https://v6.example/",
      status(410),
      dns({
        "v6.example": {
          A: { addresses: [], status: 0 },
          AAAA: { addresses: [PUBLIC_V6], status: 0 },
        },
      })
    );
    expect((await result).outcome).toBe("dead");
    expect(seen).toHaveLength(1);
  });

  test("a host with a public and a private address is unsure, without asking the link fetcher", async () => {
    let hops = 0;
    const result = await checkLink(
      { url: "https://split.example/" },
      {
        hop: () => {
          hops += 1;
          return Promise.resolve(new Response(null, { status: 404 }));
        },
        lookup: dns({
          "split.example": {
            A: { addresses: [PUBLIC, "192.168.0.4"], status: 0 },
            AAAA: { addresses: [], status: 0 },
          },
        }),
      }
    );
    expect(result).toEqual({ outcome: "unsure", reason: "blocked" });
    expect(hops).toBe(0);
  });

  test("reads NXDOMAIN and addresses from a DoH answer", async () => {
    const doh = createDohLookup(((input: RequestInfo | URL) => {
      const name = new URL(String(input)).searchParams.get("name");
      return Promise.resolve(
        name === "example.com"
          ? Response.json({
              Answer: [
                { data: "example.edgekey.net.", type: 5 },
                { data: PUBLIC, type: 1 },
              ],
              Status: 0,
            })
          : Response.json({ Status: 3 })
      );
    }) as typeof fetch);
    const signal = new AbortController().signal;
    expect(await doh("example.com", "A", signal)).toEqual({
      addresses: [PUBLIC],
      status: 0,
    });
    expect(await doh("gone.example", "AAAA", signal)).toEqual({
      addresses: [],
      status: 3,
    });
  });

  test("a DoH server that fails is a failed lookup, not NXDOMAIN", async () => {
    const doh = createDohLookup((() =>
      Promise.resolve(
        new Response("bad gateway", { status: 502 })
      )) as typeof fetch);
    await expect(
      doh("example.com", "A", new AbortController().signal)
    ).rejects.toThrow("doh_status_502");
  });
});

describe("check-link requests", () => {
  test.each([405, 501])(
    "falls back to GET when HEAD gets %d",
    async (refused) => {
      const { result, seen } = check("https://example.com/", (_url, method) =>
        method === "HEAD"
          ? new Response(null, { status: refused })
          : new Response("Not here", { status: 404 })
      );
      expect(await result).toEqual({
        httpStatus: 404,
        outcome: "dead",
        reason: "http_404",
      });
      expect(seen.map((hop) => hop.method)).toEqual(["HEAD", "GET"]);
    }
  );

  test("a URL the policy refuses is unsure without a lookup", async () => {
    const lookup = dns({});
    const { result, seen } = check(
      "http://127.0.0.1/admin",
      status(404),
      lookup
    );
    expect(await result).toEqual({ outcome: "unsure", reason: "blocked" });
    expect(lookup.queries).toEqual([]);
    expect(seen).toEqual([]);
  });

  test("the Container refusing the address is unsure", async () => {
    const container = createContainerNetwork(() => new Response("secret"));
    const result = await checkLink(
      { url: "https://example.com/" },
      {
        // A Worker-side bug that hands over a private address still stops at
        // the Container.
        hop: (url, _addresses, init) =>
          createContainerPinnedFetch(container.env)(url, ["10.0.0.1"], init),
        lookup: dns({ "example.com": resolves() }),
      }
    );
    expect(result).toEqual({ outcome: "unsure", reason: "blocked" });
    expect(container.requests).toEqual([]);
  });

  test("a connection that fails is unsure", async () => {
    const result = await checkLink(
      { url: "https://example.com/" },
      {
        hop: () => Promise.reject(new TypeError("fetch failed: reset")),
        lookup: dns({ "example.com": resolves() }),
      }
    );
    expect(result).toEqual({ outcome: "unsure", reason: "fetch_failed" });
  });

  test("a missing link fetcher is unsure", async () => {
    const result = await checkLink(
      { url: "https://example.com/" },
      {
        hop: createContainerPinnedFetch({}),
        lookup: dns({ "example.com": resolves() }),
      }
    );
    expect(result).toEqual({
      outcome: "unsure",
      reason: "fetcher_unavailable",
    });
  });

  test("a host that never answers is unsure once the time is up", async () => {
    const started = Date.now();
    const result = await checkLink(
      { url: "https://example.com/" },
      {
        hop: () => new Promise<Response>(() => undefined),
        lookup: dns({ "example.com": resolves() }),
        timeoutMs: 50,
      }
    );
    expect(result).toEqual({ outcome: "unsure", reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("a DNS server that never answers is unsure once the time is up", async () => {
    const result = await checkLink(
      { url: "https://example.com/" },
      {
        hop: () => Promise.resolve(new Response(null, { status: 404 })),
        lookup: () => new Promise<DnsAnswer>(() => undefined),
        timeoutMs: 50,
      }
    );
    expect(result).toEqual({ outcome: "unsure", reason: "timeout" });
  });
});

describe("the check-link op", () => {
  const SECRET = "test-secret";

  /** Any R2 call fails the test: the check never reads or writes storage. */
  const untouchableBucket = new Proxy(
    {},
    {
      get: (_target, name) => {
        throw new Error(`check-link touched R2: ${String(name)}`);
      },
    }
  );

  const sendOp = async (params: unknown, env: Partial<FilesOpsEnv> = {}) => {
    const body = JSON.stringify({
      op: "check-link",
      params,
      version: FILES_PROTOCOL_VERSION,
    });
    const requestId = crypto.randomUUID();
    const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
    const response = await handleInternalOp(
      new Request("https://files.teakvault.com/__ops/v1", {
        body,
        headers: {
          "x-teak-expires-at": expiresAt,
          "x-teak-request-id": requestId,
          "x-teak-signature": await hmacSha256Hex(
            SECRET,
            buildFilesOpSigningPayload({
              bodySha256: await sha256Hex(body),
              expiresAt,
              requestId,
            })
          ),
        },
        method: "POST",
      }),
      {
        BUCKET: untouchableBucket as never,
        FILES_SIGNING_SECRET: SECRET,
        ...env,
      } as FilesOpsEnv
    );
    return {
      body: (await response.json()) as { data?: unknown },
      status: response.status,
    };
  };

  test("checks a link at an address through the link fetcher", async () => {
    const container = createContainerNetwork(
      () => new Response(null, { status: 410 })
    );
    const { body, status: code } = await sendOp(
      { url: `http://${PUBLIC}/gone` },
      container.env
    );
    expect(code).toBe(200);
    expect(body.data).toEqual({
      httpStatus: 410,
      outcome: "dead",
      reason: "http_410",
    });
    expect(container.requests).toEqual([
      { addresses: [PUBLIC], url: `http://${PUBLIC}/gone` },
    ]);
  });

  test("answers unsure when the link fetcher is missing", async () => {
    const { body, status: code } = await sendOp({ url: `https://${PUBLIC}/` });
    expect(code).toBe(200);
    expect(body.data).toEqual({
      outcome: "unsure",
      reason: "fetcher_unavailable",
    });
  });

  test.each([
    ["no URL", {}],
    ["a URL that is not http", { url: "ftp://example.com/file" }],
    [
      "a URL past the length limit",
      { url: `https://e.com/${"a".repeat(5000)}` },
    ],
  ])("refuses %s", async (_name, params) => {
    const { status: code } = await sendOp(params);
    expect(code).toBe(400);
  });
});
