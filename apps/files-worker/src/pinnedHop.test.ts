import { describe, expect, test } from "bun:test";
import { SsrfError, safeFetch } from "@teak/convex/linkMetadata/ssrf";
import { createContainerPinnedFetch, createDohResolver } from "./pinnedHop";
import { createContainerNetwork } from "./test/cardProcessingKit";

const PUBLIC = "93.184.216.34";
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";

/** A DNS-over-HTTPS server answering from `records` (name → A/AAAA lists). */
const dohServer = (
  records: Record<string, { A?: string[]; AAAA?: string[]; cname?: string }>
) => {
  const queries: string[] = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const name = url.searchParams.get("name") ?? "";
    const type = url.searchParams.get("type") as "A" | "AAAA";
    queries.push(`${name} ${type}`);
    expect(new Headers(init?.headers).get("accept")).toBe(
      "application/dns-json"
    );
    const record = records[name];
    if (!record) {
      return Promise.resolve(Response.json({ Status: 3 }));
    }
    return Promise.resolve(
      Response.json({
        Answer: [
          ...(record.cname ? [{ data: record.cname, name, type: 5 }] : []),
          ...(record[type] ?? []).map((data) => ({
            data,
            name,
            type: type === "A" ? 1 : 28,
          })),
        ],
        Status: 0,
      })
    );
  }) as typeof fetch;
  return { fetcher, queries };
};

describe("DNS over HTTPS", () => {
  test("returns every A and AAAA address, without the CNAME chain", async () => {
    const { fetcher, queries } = dohServer({
      "www.example.com": {
        A: [PUBLIC],
        AAAA: [PUBLIC_V6],
        cname: "example.edgekey.net.",
      },
    });
    expect(await createDohResolver(fetcher)("www.example.com")).toEqual([
      PUBLIC,
      PUBLIC_V6,
    ]);
    expect(queries.sort()).toEqual([
      "www.example.com A",
      "www.example.com AAAA",
    ]);
  });

  test("a name that does not exist has no addresses", async () => {
    const { fetcher } = dohServer({});
    expect(await createDohResolver(fetcher)("nowhere.example")).toEqual([]);
  });

  test("fails when the resolver cannot be reached", async () => {
    const down = (() =>
      Promise.resolve(new Response("down", { status: 502 }))) as typeof fetch;
    await expect(createDohResolver(down)("example.com")).rejects.toThrow(
      "doh_unavailable"
    );
  });
});

describe("safeFetch through the link fetcher", () => {
  test("pins each hop to the checked addresses and returns the page", async () => {
    const network = createContainerNetwork(() => Response.json({ ok: true }));
    const { fetcher } = dohServer({ "api.example": { A: [PUBLIC] } });
    const { response } = await safeFetch(
      "https://api.example/post.json",
      createDohResolver(fetcher),
      { headers: { accept: "application/json", cookie: "dropped" } },
      createContainerPinnedFetch(network.env)
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(network.requests).toEqual([
      { addresses: [PUBLIC], url: "https://api.example/post.json" },
    ]);
  });

  test("never follows a redirect to a private host", async () => {
    const network = createContainerNetwork((url) =>
      url.startsWith("https://api.example/")
        ? Response.redirect("https://internal.example/admin", 302)
        : Response.json({ secret: true })
    );
    const { fetcher } = dohServer({
      "api.example": { A: [PUBLIC] },
      "internal.example": { A: ["10.0.0.7"] },
    });
    await expect(
      safeFetch(
        "https://api.example/post.json",
        createDohResolver(fetcher),
        {},
        createContainerPinnedFetch(network.env)
      )
    ).rejects.toBeInstanceOf(SsrfError);
    expect(network.requests.map((request) => request.url)).toEqual([
      "https://api.example/post.json",
    ]);
  });

  test("the Container refuses a private address whatever the Worker sends", async () => {
    const network = createContainerNetwork(() => new Response("secret"));
    await expect(
      createContainerPinnedFetch(network.env)(
        "https://looks-fine.example/",
        ["169.254.169.254"],
        {}
      )
    ).rejects.toBeInstanceOf(SsrfError);
    expect(network.requests).toEqual([]);
  });

  test("brings back one byte past the cap, so readBodyWithLimit refuses it", async () => {
    const network = createContainerNetwork(
      () => new Response(new Uint8Array(4096).fill(97))
    );
    const response = await createContainerPinnedFetch(network.env, {
      maxBytes: 100,
    })("https://api.example/big", [PUBLIC], {});
    expect((await response.arrayBuffer()).byteLength).toBe(101);
  });

  test("gives up when the caller's signal does", async () => {
    const network = createContainerNetwork(() => Response.json({}));
    const controller = new AbortController();
    controller.abort(new Error("caller timeout"));
    await expect(
      createContainerPinnedFetch(network.env)(
        "https://api.example/x",
        [PUBLIC],
        { signal: controller.signal }
      )
    ).rejects.toThrow("caller timeout");
  });
});
