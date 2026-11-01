import { describe, expect, test } from "bun:test";
import type { PinnedFetch } from "@teak/convex/linkMetadata/ssrf";
import { createFetcherHandler } from "../../fetcher/src/handler";
import { FakeBucket } from "../test/testsupport";
import { type ArchivePageEnv, runArchivePage } from "./archivePage";

const PUBLIC = "93.184.216.34";
const DESTINATION = "users/u1/cards/c1/page-archive/r1-archive.html";
const PAGE_URL = "https://site.example/post";

const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
  ),
  (char) => char.charCodeAt(0)
);

const network = (
  routes: Record<string, () => Response>,
  dns: Record<string, string[]> = {}
) => {
  const requested: string[] = [];
  const pinnedFetch: PinnedFetch = (url) => {
    requested.push(url);
    return Promise.resolve(
      routes[url]?.() ?? new Response("Not found", { status: 404 })
    );
  };
  const resolveDns = (hostname: string) =>
    Promise.resolve(dns[hostname] ?? [PUBLIC]);
  const handle = createFetcherHandler({ pinnedFetch, resolveDns });
  const bucket = new FakeBucket();
  const env = {
    BUCKET: bucket as unknown as R2Bucket,
    LINK_FETCHER: {
      get: () => ({ fetch: (request: Request) => handle(request) }),
      idFromName: (name: string) => name,
    } as unknown as DurableObjectNamespace,
    LINK_FETCHER_INSTANCES: "1",
  } satisfies ArchivePageEnv;
  const archive = async () => {
    const result = await runArchivePage(
      env,
      { capturedAt: 1, destinationKey: DESTINATION, url: PAGE_URL },
      { resolveDns }
    );
    const stored = bucket.objects.get(DESTINATION)?.bytes;
    return {
      html: stored ? new TextDecoder().decode(stored) : "",
      result,
    };
  };
  return { archive, requested };
};

const html = (body: string) => () =>
  new Response(`<html><head>${body}</head><body><p>Post</p></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

describe("archive-page subresources", () => {
  test("a stylesheet that redirects to a private address is refused", async () => {
    const { archive, requested } = network({
      [PAGE_URL]: html('<link rel="stylesheet" href="/s.css">'),
      "https://site.example/s.css": () =>
        Response.redirect("http://10.0.0.5/s.css", 302),
      "http://10.0.0.5/s.css": () =>
        new Response(".private{color:red}", {
          headers: { "content-type": "text/css" },
        }),
    });

    const { html: archived, result } = await archive();

    expect(result).toMatchObject({ kind: "full", stored: true });
    expect(requested).not.toContain("http://10.0.0.5/s.css");
    expect(archived).not.toContain(".private");
  });

  test("an image on a host that resolves to loopback is never fetched", async () => {
    const { archive, requested } = network(
      {
        [PAGE_URL]: () =>
          new Response(
            '<html><body><img src="https://inside.example/a.png" alt="inside"><img src="https://cdn.example/b.png" alt="public"></body></html>',
            { headers: { "content-type": "text/html" } }
          ),
        "https://cdn.example/b.png": () =>
          new Response(ONE_PIXEL_PNG, {
            headers: { "content-type": "image/png" },
          }),
      },
      { "inside.example": ["127.0.0.1"] }
    );

    const { html: archived } = await archive();

    expect(requested).not.toContain("https://inside.example/a.png");
    expect(requested).toContain("https://cdn.example/b.png");
    expect(archived).toContain('alt="public"');
    expect(archived).toMatch(
      /<img src="data:image\/png;base64,[^"]+" alt="public">/u
    );
    expect(archived).toMatch(/alt="inside" data-teak-dropped/u);
  });

  test("a stylesheet one byte over 4 MiB is left out", async () => {
    const tooBig = `.big{color:red}${" ".repeat(4 * 1024 * 1024 + 1 - 15)}`;
    const { archive } = network({
      [PAGE_URL]: html(
        '<link rel="stylesheet" href="/big.css"><link rel="stylesheet" href="/ok.css">'
      ),
      "https://site.example/big.css": () =>
        new Response(tooBig, { headers: { "content-type": "text/css" } }),
      "https://site.example/ok.css": () =>
        new Response(".ok{color:blue}", {
          headers: { "content-type": "text/css" },
        }),
    });

    const { html: archived } = await archive();

    expect(archived).not.toContain(".big{color:red}");
    expect(archived).toContain(".ok{color:blue}");
  });

  test("needs no Browser Rendering binding", async () => {
    const { archive } = network({ [PAGE_URL]: html("<title>Post</title>") });
    const { result } = await archive();
    expect(result).toMatchObject({ source: "server", stored: true });
  });
});
