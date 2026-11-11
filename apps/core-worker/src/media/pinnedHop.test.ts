import { describe, expect, test } from "bun:test";
import { SsrfError, safeFetch } from "@teak/files-protocol/ssrf";
import { createDohResolver } from "../dns";
import { createContainerNetwork } from "../test/cardProcessingKit";
import { dohServer } from "../test/dohServer";
import {
  createContainerPinnedFetch,
  createContainerStreamingFetch,
} from "./pinnedHop";

const PUBLIC = "93.184.216.34";

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

  test("a streaming fetch brings back a body past a buffered hop's cap", async () => {
    const audio = new Uint8Array(6 * 1024 * 1024).fill(7);
    const network = createContainerNetwork(
      () => new Response(audio, { headers: { "content-type": "audio/mpeg" } })
    );
    const options = { maxBytes: 100 * 1024 * 1024, timeoutMs: 60_000 };
    const response = await createContainerStreamingFetch(network.env, options)(
      "https://cdn.example/episode.mp3",
      [PUBLIC],
      {}
    );
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect((await response.arrayBuffer()).byteLength).toBe(audio.byteLength);

    const buffered = await createContainerPinnedFetch(network.env)(
      "https://cdn.example/episode.mp3",
      [PUBLIC],
      {}
    );
    expect((await buffered.arrayBuffer()).byteLength).toBe(1024 * 1024 + 1);
  });

  test("a streaming fetch is refused a private address too", async () => {
    const network = createContainerNetwork(() => new Response("secret"));
    await expect(
      createContainerStreamingFetch(network.env, {
        maxBytes: 1024,
        timeoutMs: 60_000,
      })("https://looks-fine.example/", ["10.0.0.7"], {})
    ).rejects.toBeInstanceOf(SsrfError);
    expect(network.requests).toEqual([]);
  });
});
