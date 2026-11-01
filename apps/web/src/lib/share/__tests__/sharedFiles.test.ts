import { describe, expect, test } from "bun:test";
import { SHARE_FILE_NAME_HEADER } from "../sharedContent";
import { discardSharedFiles, takeSharedFiles } from "../sharedFiles";

const fakeStorage = () => {
  const entries = new Map<string, Response>();
  const cache = {
    keys: () =>
      Promise.resolve([...entries.keys()].map((url) => new Request(url))),
    match: (request: Request) =>
      Promise.resolve(entries.get(request.url)?.clone()),
    delete: (request: Request) => Promise.resolve(entries.delete(request.url)),
    put: (path: string, response: Response) => {
      entries.set(`https://teak.test${path}`, response);
    },
  };
  const storage = {
    open: () => Promise.resolve(cache),
  } as unknown as CacheStorage;
  return { cache, entries, storage };
};

const kept = (body: string, name: string, type: string) =>
  new Response(new Blob([body], { type }), {
    headers: {
      "content-type": type,
      [SHARE_FILE_NAME_HEADER]: encodeURIComponent(name),
    },
  });

describe("takeSharedFiles", () => {
  test("returns a share's files in order and deletes them", async () => {
    const { cache, entries, storage } = fakeStorage();
    cache.put("/__share/1-a/1", kept("two", "b é.pdf", "application/pdf"));
    cache.put("/__share/1-a/0", kept("one", "a.png", "image/png"));
    cache.put("/__share/2-b/0", kept("other", "c.txt", "text/plain"));

    const files = await takeSharedFiles(storage, "1-a");

    expect(files?.map((file) => [file.name, file.type])).toEqual([
      ["a.png", "image/png"],
      ["b é.pdf", "application/pdf"],
    ]);
    expect(await files?.[1]?.text()).toBe("two");
    expect([...entries.keys()]).toEqual(["https://teak.test/__share/2-b/0"]);
  });

  test("keeps a share's files while asking, then discards them", async () => {
    const { cache, entries, storage } = fakeStorage();
    cache.put("/__share/1-a/0", kept("one", "a.png", "image/png"));
    cache.put("/__share/2-b/0", kept("other", "c.txt", "text/plain"));

    const first = await takeSharedFiles(storage, "1-a", { keep: true });
    const again = await takeSharedFiles(storage, "1-a", { keep: true });
    expect(first?.map((file) => file.name)).toEqual(["a.png"]);
    expect(again?.map((file) => file.name)).toEqual(["a.png"]);

    await discardSharedFiles(storage, "1-a");
    expect([...entries.keys()]).toEqual(["https://teak.test/__share/2-b/0"]);
    expect(await takeSharedFiles(storage, "1-a")).toBeNull();
  });

  test("is null when the files are gone or were never kept", async () => {
    const { storage } = fakeStorage();
    expect(await takeSharedFiles(storage, "9-z")).toBeNull();
    expect(await takeSharedFiles(storage, "missing")).toBeNull();
    expect(await takeSharedFiles(undefined, "9-z")).toBeNull();
  });
});
