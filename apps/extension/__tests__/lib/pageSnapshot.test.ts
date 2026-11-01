/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import {
  capturePageSnapshot,
  type PageSnapshot,
  serializeRenderedPage,
  uploadPageSnapshot,
} from "../../lib/pageSnapshot";
import { saveToTeak } from "../../lib/saveToTeak";

const gunzip = async (bytes: Uint8Array<ArrayBuffer>) =>
  await new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
  ).text();

const page = (html: string, url = "https://example.com/post") =>
  mock((injection: { func: unknown; target: { tabId: number } }) => {
    expect(injection.func).toBe(serializeRenderedPage);
    return Promise.resolve([{ result: { html, url } }]);
  });

describe("capturePageSnapshot", () => {
  test("reads the tab's page and gzips it", async () => {
    const executeScript = page("<html><body><p>Seen</p></body></html>");
    const snapshot = await capturePageSnapshot(7, { executeScript });
    expect(executeScript.mock.calls[0]?.[0].target).toEqual({ tabId: 7 });
    expect(snapshot?.url).toBe("https://example.com/post");
    expect(await gunzip(snapshot?.gzip as Uint8Array<ArrayBuffer>)).toBe(
      "<html><body><p>Seen</p></body></html>"
    );
  });

  test("skips a page over 20 MiB gzipped", async () => {
    const noise = new Uint8Array(22 * 1024 * 1024);
    for (let offset = 0; offset < noise.length; offset += 65_536) {
      crypto.getRandomValues(noise.subarray(offset, offset + 65_536));
    }
    const html = new TextDecoder("latin1").decode(noise);
    expect(
      await capturePageSnapshot(7, { executeScript: page(html) })
    ).toBeNull();
  }, 30_000);

  test("gives up after 3 seconds", async () => {
    const started = Date.now();
    const snapshot = await capturePageSnapshot(7, {
      executeScript: () => new Promise(() => undefined),
    });
    const waited = Date.now() - started;
    expect(snapshot).toBeNull();
    expect(waited).toBeGreaterThanOrEqual(2900);
    expect(waited).toBeLessThan(4000);
  });

  test("a tab that moved on to another page gives no snapshot", async () => {
    const executeScript = page("<p>Next page</p>", "https://example.com/next");
    expect(
      await capturePageSnapshot(7, {
        executeScript,
        expectedUrl: "https://example.com/post",
      })
    ).toBeNull();
    expect(
      await capturePageSnapshot(7, {
        executeScript,
        expectedUrl: "https://example.com/next",
      })
    ).not.toBeNull();
  });

  test("a page the extension can't read gives no snapshot", async () => {
    expect(
      await capturePageSnapshot(7, {
        executeScript: () => Promise.reject(new Error("Cannot access")),
      })
    ).toBeNull();
  });
});

describe("saveToTeak with a page snapshot", () => {
  const snapshot: PageSnapshot = {
    gzip: new Uint8Array([31, 139, 8, 0, 1, 2, 3]),
    url: "https://example.com/post",
  };
  const UPLOAD = {
    expiresIn: 600,
    fileKey: "users/u/cards/upload-pending-v2/page-snapshot/s1",
    maxFileSize: 20 * 1024 * 1024,
    method: "PUT",
    uploadUrl: "https://files.example.com/__upload/v1/s1",
  };

  const api = (uploadStatus = 200) =>
    mock(async (path: string, _init?: RequestInit) =>
      path === "/v1/page-snapshots/upload"
        ? Response.json(uploadStatus === 200 ? UPLOAD : { code: "X" }, {
            status: uploadStatus,
          })
        : Response.json({ cardId: "card_1", status: "created" })
    );
  const bodyOf = (request: ReturnType<typeof api>, path: string) =>
    JSON.parse(
      String(request.mock.calls.find(([called]) => called === path)?.[1]?.body)
    );

  test("uploads the page, then saves the link with its key", async () => {
    const request = api();
    const fetchImpl = mock(async () => new Response(null, { status: 200 }));
    const kept: string[] = [];

    const result = await saveToTeak(
      { content: "https://example.com/post", source: "shortcut" },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onPageSnapshotUploaded: (key) => {
          kept.push(key);
          return Promise.resolve();
        },
        pageSnapshot: snapshot,
        request,
      }
    );

    expect(result).toEqual({ cardId: "card_1", status: "saved" });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/v1/page-snapshots/upload",
      "/v1/cards",
    ]);
    expect(bodyOf(request, "/v1/page-snapshots/upload")).toEqual({ bytes: 7 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(UPLOAD.uploadUrl);
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("Content-Type")).toBe(
      "application/gzip"
    );
    expect(init.body).toBe(snapshot.gzip);
    expect(bodyOf(request, "/v1/cards")).toEqual({
      pageSnapshotKey: UPLOAD.fileKey,
      url: "https://example.com/post",
    });
    expect(kept).toEqual([UPLOAD.fileKey]);
  });

  test.each([
    ["the upload can't be prepared", 500, 200],
    ["the PUT fails", 200, 503],
  ])("saves the link anyway when %s", async (_name, prepare, put) => {
    const request = api(prepare);
    const result = await saveToTeak(
      { content: "https://example.com/post", source: "popup-auto-save" },
      {
        fetchImpl: (async () =>
          new Response(null, { status: put })) as unknown as typeof fetch,
        pageSnapshot: snapshot,
        request,
      }
    );
    expect(result).toEqual({ cardId: "card_1", status: "saved" });
    expect(bodyOf(request, "/v1/cards")).toEqual({
      url: "https://example.com/post",
    });
  });

  test("an upload that stalls gives up, so the link saves without it", async () => {
    const signals: AbortSignal[] = [];
    const started = Date.now();
    const key = await uploadPageSnapshot(snapshot, {
      fetchImpl: ((_url: string, init?: RequestInit) => {
        if (init?.signal) {
          signals.push(init.signal);
        }
        return new Promise(() => undefined);
      }) as unknown as typeof fetch,
      request: api(),
      timeoutMs: 50,
    });
    expect(key).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
  });

  test("a retry sends the key the first attempt uploaded, without uploading again", async () => {
    const request = api();
    await saveToTeak(
      {
        content: "https://example.com/post",
        pageSnapshotKey: UPLOAD.fileKey,
        source: "shortcut",
      },
      { pageSnapshot: null, request }
    );
    expect(request.mock.calls.map(([path]) => path)).toEqual(["/v1/cards"]);
    expect(bodyOf(request, "/v1/cards").pageSnapshotKey).toBe(UPLOAD.fileKey);
  });

  test("text saves never send a snapshot", async () => {
    const request = api();
    await saveToTeak(
      { content: "A quote from the page", source: "context-menu" },
      { pageSnapshot: snapshot, request }
    );
    expect(request.mock.calls.map(([path]) => path)).toEqual(["/v1/cards"]);
  });
});
