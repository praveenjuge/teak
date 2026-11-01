import { describe, expect, test } from "bun:test";
import {
  SHARE_FILE_NAME_HEADER,
  SHARE_FILES_MISSING,
  shareLibraryPath,
} from "../sharedContent";
import { shareWorkerSource } from "../shareWorker";

type Listener = (event: Record<string, unknown>) => void;

const startWorker = ({ fullAfter = Number.POSITIVE_INFINITY } = {}) => {
  const listeners = new Map<string, Listener>();
  const entries = new Map<string, Response>();
  const cache = {
    keys: () =>
      Promise.resolve([...entries.keys()].map((url) => new Request(url))),
    // Like Cache Storage, it takes a request or a path.
    delete: (request: Request | string) =>
      Promise.resolve(
        entries.delete(
          typeof request === "string"
            ? `https://teak.test${request}`
            : request.url
        )
      ),
    put: (path: string, response: Response) => {
      if (entries.size >= fullAfter) {
        return Promise.reject(
          new DOMException("Quota exceeded", "QuotaExceededError")
        );
      }
      entries.set(`https://teak.test${path}`, response);
      return Promise.resolve();
    },
  };
  const scope = {
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    clients: { claim: () => Promise.resolve() },
    location: { origin: "https://teak.test" },
    skipWaiting: () => undefined,
  };
  new Function("self", "caches", shareWorkerSource)(scope, {
    open: () => Promise.resolve(cache),
  });
  const fetch = (request: Request) => {
    let response: Promise<Response> | undefined;
    listeners.get("fetch")?.({
      request,
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
    });
    return response;
  };
  return { entries, fetch };
};

describe("the share service worker", () => {
  test("keeps shared files and opens the composer with the text", async () => {
    const worker = startWorker();
    const form = new FormData();
    form.set("title", "Example");
    form.set("text", "Look at this");
    form.set("url", "https://example.com/a");
    form.append(
      "files",
      new File(["png"], "shot one.png", { type: "image/png" })
    );
    form.append(
      "files",
      new File(["pdf"], "doc.pdf", { type: "application/pdf" })
    );

    const response = await worker.fetch(
      new Request("https://teak.test/share", { method: "POST", body: form })
    );

    expect(response?.status).toBe(303);
    const location = new URL(response?.headers.get("location") ?? "");
    expect(location.pathname).toBe("/");
    expect(location.searchParams.get("compose")).toBe("1");
    expect(location.searchParams.get("text")).toBe("Look at this");
    expect(location.searchParams.get("url")).toBe("https://example.com/a");
    const id = location.searchParams.get("share") ?? "";
    expect(id).toMatch(/^\d+-/);
    const kept = [...worker.entries.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    );
    expect(kept.map(([url]) => new URL(url).pathname)).toEqual([
      `/__share/${id}/0`,
      `/__share/${id}/1`,
    ]);
    expect(kept[0]?.[1].headers.get(SHARE_FILE_NAME_HEADER)).toBe(
      "shot%20one.png"
    );
  });

  test("keeps the text when the files can't be stored", async () => {
    const worker = startWorker({ fullAfter: 1 });
    const form = new FormData();
    form.set("text", "Look at this");
    form.append("files", new File(["a"], "a.png", { type: "image/png" }));
    form.append("files", new File(["b"], "b.png", { type: "image/png" }));

    const response = await worker.fetch(
      new Request("https://teak.test/share", { method: "POST", body: form })
    );

    const location = new URL(response?.headers.get("location") ?? "");
    expect(location.searchParams.get("text")).toBe("Look at this");
    expect(location.searchParams.get("share")).toBe("missing");
    expect(worker.entries.size).toBe(0);
  });

  test("cuts long text exactly as the /share route does", async () => {
    const worker = startWorker();
    const shared = {
      title: "A page",
      text: "長い引用、そして「記号」。".repeat(400),
      url: "https://example.com/a",
    };
    const form = new FormData();
    for (const [field, value] of Object.entries(shared)) {
      form.set(field, value);
    }
    form.append("files", new File(["a"], "a.png", { type: "image/png" }));
    const response = await worker.fetch(
      new Request("https://teak.test/share", { method: "POST", body: form })
    );
    const location = new URL(response?.headers.get("location") ?? "");
    location.searchParams.set("share", SHARE_FILES_MISSING);
    expect(`${location.pathname}${location.search}`).toBe(
      shareLibraryPath(shared, SHARE_FILES_MISSING)
    );
  });

  test("leaves every other request to the browser", () => {
    const worker = startWorker();
    expect(worker.fetch(new Request("https://teak.test/"))).toBeUndefined();
    expect(
      worker.fetch(new Request("https://teak.test/share"))
    ).toBeUndefined();
    expect(
      worker.fetch(
        new Request("https://elsewhere.test/share", { method: "POST" })
      )
    ).toBeUndefined();
  });

  test("text alone keeps no files", async () => {
    const worker = startWorker();
    const form = new FormData();
    form.set("text", "https://example.com/b");
    const response = await worker.fetch(
      new Request("https://teak.test/share", { method: "POST", body: form })
    );
    const location = new URL(response?.headers.get("location") ?? "");
    expect(location.searchParams.has("share")).toBe(false);
    expect(worker.entries.size).toBe(0);
  });
});
