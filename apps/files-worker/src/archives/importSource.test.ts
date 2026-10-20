import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { FakeBucket, fakeHttpEtag } from "../test/testsupport";
import { indexImportSource, readImportMarkdown } from "./importSource";
import {
  ArchiveEntryTooLargeError,
  extractZipEntries,
  readZipDirectory,
  readZipEntry,
} from "./zip";

const sourceKey = "users/u/imports/job/source.zip";
function archive(files: Record<string, Uint8Array>) {
  const bucket = new FakeBucket();
  const bytes = zipSync(files, { level: 0 });
  bucket.objects.set(sourceKey, { bytes });
  return {
    bucket,
    params: { sourceKey, mode: "archive" as const, expectedSize: bytes.length },
    bytes,
  };
}
const asBucket = (bucket: FakeBucket) => bucket as unknown as R2Bucket;

describe("worker import source", () => {
  test("matches CP437 filenames in both ZIP headers to Unicode manifest paths", async () => {
    const { bucket, params, bytes } = archive({
      "manifest.json": strToU8(
        JSON.stringify({
          version: 1,
          cards: [{ type: "document", file: { path: "files/café.md" } }],
        })
      ),
      "files/cafX.md": strToU8("# Café"),
    });
    const name = strToU8("files/cafX.md");
    for (let i = 0; i <= bytes.length - name.length; i++) {
      if (name.every((byte, j) => bytes[i + j] === byte)) {
        bytes[i + 9] = 130;
      }
    }
    const page = await indexImportSource(asBucket(bucket), params);
    expect(page.items[0].file?.path).toBe("files/café.md");
    expect(
      await readImportMarkdown(asBucket(bucket), {
        sourceKey,
        sourceEtag: page.sourceEtag,
        path: "files/café.md",
      })
    ).toEqual({ content: "# Café", type: "text" });
  });
  test("pages inline manifest cards and returns only referenced file facts", async () => {
    const cards = Array.from({ length: 103 }, (_, i) => ({
      type: "text",
      content: `Card ${i}`,
    }));
    const { bucket, params } = archive({
      "manifest.json": strToU8(JSON.stringify({ version: 1, cards })),
    });
    const first = await indexImportSource(asBucket(bucket), params);
    expect(first.total).toBe(103);
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).toBe(100);
    expect(first.items[0]).toEqual({ sourceIndex: 0, card: cards[0] });
    const last = await indexImportSource(asBucket(bucket), {
      ...params,
      cursor: first.nextCursor!,
      sourceEtag: first.sourceEtag,
    });
    expect(last.items.map((item) => item.sourceIndex)).toEqual([100, 101, 102]);
    expect(last.nextCursor).toBeNull();
  });
  test("supports separate array and object cards.json, legacy version, and empty archives", async () => {
    for (const cards of [[], [{ type: "text", content: "hello" }]]) {
      for (const json of [cards, { cards }]) {
        const { bucket, params } = archive({
          "manifest.json": strToU8('{"exportVersion":1}'),
          "cards.json": strToU8(JSON.stringify(json)),
        });
        const result = await indexImportSource(asBucket(bucket), params);
        expect(result.total).toBe(cards.length);
        expect(result.nextCursor).toBeNull();
      }
    }
  });
  test("reads schema v1 and v2 Teak exports, passing v2 card fields through", async () => {
    const v1Card = { id: "c1", type: "text", content: "Old", tags: [] };
    const v2Card = {
      ...v1Card,
      id: "c2",
      metadataTitle: "Kept title",
      isArchived: true,
      folders: ["Reading", 'Design, "refs"'],
      aiTags: ["ui"],
      aiSummary: "A summary",
    };
    for (const [schemaVersion, card] of [
      [1, v1Card],
      [2, v2Card],
    ] as const) {
      const { bucket, params } = archive({
        "manifest.json": strToU8(
          JSON.stringify({ exportVersion: 1, schemaVersion, appName: "Teak" })
        ),
        "cards.json": strToU8(JSON.stringify({ cards: [card] }, null, 2)),
        "bookmarks.html": strToU8("<!DOCTYPE NETSCAPE-Bookmark-file-1>"),
        "cards.csv": strToU8('\uFEFF"id"\r\n'),
      });
      const result = await indexImportSource(asBucket(bucket), params);
      expect(result.total).toBe(1);
      expect(result.items[0]?.card).toEqual(card);
    }
  });
  const upload = (mode: string, body: string | Uint8Array) => {
    const bucket = new FakeBucket();
    const bytes = typeof body === "string" ? strToU8(body) : body;
    bucket.objects.set(sourceKey, { bytes });
    return {
      bucket: asBucket(bucket),
      params: { sourceKey, mode, expectedSize: bytes.length } as never,
    };
  };
  test("routes every text source to its parser", async () => {
    const files: Record<string, string> = {
      bookmarks:
        '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Work</H3><DL><p><DT><A HREF="https://a.test/b">B</A></DL></DL>',
      pocket:
        "title,url,time_added,tags,status\nP,https://a.test/p,1700000000,x,archive",
      raindrop: "url,title,folder\nhttps://a.test/r,R,Inbox/Later",
      instapaper:
        "URL,Title,Selection,Folder,Timestamp\nhttps://a.test/i,I,,Starred,1700000000",
      readwise:
        "Title,URL,Document tags,Saved date,Location\nRW,https://a.test/rw,[],2024-01-01,archive",
      omnivore:
        '[{"url":"https://a.test/o","title":"O","labels":[],"savedAt":"2024-01-01","state":"Archived"}]',
      linkwarden:
        '{"collections":[{"id":1,"name":"L","parentId":null,"links":[{"name":"L1","url":"https://a.test/l","tags":[],"createdAt":"2024-01-01"}]}]}',
      mymind:
        "id,type,title,url,content,note,tags,created\n1,Note,M,,Some text,,,2024-01-01",
      onetab: "https://a.test/t | T",
    };
    for (const [mode, body] of Object.entries(files)) {
      const { bucket, params } = upload(mode, body);
      const page = await indexImportSource(bucket, params);
      expect(page.total).toBe(1);
      expect(page.items[0]?.card).toBeDefined();
    }
    const { bucket, params } = upload("raindrop", files.raindrop);
    const page = await indexImportSource(bucket, params);
    expect(page.items[0]?.card).toMatchObject({ folders: ["Inbox / Later"] });
  });
  test("a file from another source fails as an invalid source", async () => {
    const { bucket, params } = upload(
      "pocket",
      "URL,Title,Folder\nhttps://a.test,A,Unread"
    );
    await expect(indexImportSource(bucket, params)).rejects.toThrow(
      "invalid_import_source"
    );
    const unknown = upload("evernote", "x");
    await expect(
      indexImportSource(unknown.bucket, unknown.params)
    ).rejects.toThrow("invalid_import_params");
  });
  test("a file over 10,000 items fails as too many, not as the wrong source", async () => {
    const rows = Array.from(
      { length: 10_001 },
      (_, index) => `I${index},https://a.test/${index},1700000000,,unread`
    );
    const { bucket, params } = upload(
      "pocket",
      ["title,url,time_added,tags,status", ...rows].join("\n")
    );
    await expect(indexImportSource(bucket, params)).rejects.toThrow(
      "invalid_bookmark_count"
    );
  });
  test("pages an Omnivore ZIP by its metadata file names, with highlights as notes", async () => {
    const item = (index: number) => ({
      slug: `item-${index}`,
      title: `Item ${index}`,
      url: `https://a.test/${index}`,
      labels: index % 2 ? ["odd"] : [],
      savedAt: "2024-05-01T09:00:00.000Z",
      state: index === 0 ? "Archived" : "Active",
    });
    const files: Record<string, Uint8Array> = {
      "content/item-0.html": strToU8("<p>page</p>"),
      "highlights/item-0.md": strToU8("> First highlight"),
    };
    for (let start = 0; start < 130; start += 20) {
      const end = Math.min(start + 20, 130);
      files[`metadata_${start}_to_${end}.json`] = strToU8(
        JSON.stringify(
          Array.from({ length: end - start }, (_, i) => item(start + i))
        )
      );
    }
    const bytes = zipSync(files, { level: 6 });
    const { bucket, params } = upload("omnivore", bytes);
    const first = await indexImportSource(bucket, params);
    expect(first.total).toBe(130);
    expect(first.items).toHaveLength(100);
    expect(first.items[0]?.card).toMatchObject({
      content: "Item 0",
      isArchived: true,
      notes: "> First highlight",
    });
    expect(first.items[1]?.card).toMatchObject({ tags: ["odd"] });
    const rest = await indexImportSource(bucket, {
      ...(params as object),
      cursor: first.nextCursor,
      sourceEtag: first.sourceEtag,
    } as never);
    expect(rest.items.map((entry) => entry.sourceIndex)).toEqual(
      Array.from({ length: 30 }, (_, i) => 100 + i)
    );
    expect(rest.nextCursor).toBeNull();
  });
  test("finds Omnivore highlights beside metadata wrapped in a folder", async () => {
    const files = {
      "omnivore-export/metadata_0_to_1.json": strToU8(
        JSON.stringify([
          {
            slug: "wrapped",
            title: "Wrapped",
            url: "https://a.test/w",
            savedAt: "2024-05-01T09:00:00.000Z",
          },
        ])
      ),
      "omnivore-export/highlights/wrapped.md": strToU8("> Wrapped highlight"),
    };
    const { bucket, params } = upload("omnivore", zipSync(files));
    const page = await indexImportSource(bucket, params);
    expect(page.items[0]?.card?.notes).toBe("> Wrapped highlight");
  });
  test("an Omnivore ZIP without metadata files is not an Omnivore export", async () => {
    const { bucket, params } = upload(
      "omnivore",
      zipSync({ "notes.txt": strToU8("hi") })
    );
    await expect(indexImportSource(bucket, params)).rejects.toThrow(
      "invalid_import_source"
    );
  });
  test("rejects unsupported versions, missing cards, unsafe paths, and encrypted entries", async () => {
    for (const manifest of [{ version: 2, cards: [] }, { version: 1 }]) {
      const { bucket, params } = archive({
        "manifest.json": strToU8(JSON.stringify(manifest)),
      });
      await expect(indexImportSource(asBucket(bucket), params)).rejects.toThrow(
        "invalid_archive"
      );
    }
    const { bucket, params } = archive({
      "../bad": strToU8("bad"),
      "manifest.json": strToU8('{"version":1,"cards":[]}'),
    });
    await expect(indexImportSource(asBucket(bucket), params)).rejects.toThrow(
      "invalid_archive_entry"
    );
  });
  test("rejects a changed source even when its byte length is unchanged", async () => {
    const { bucket, params, bytes } = archive({
      "manifest.json": strToU8('{"version":1,"cards":[]}'),
    });
    await expect(
      indexImportSource(asBucket(bucket), { ...params, sourceEtag: '"old"' })
    ).rejects.toThrow("source_changed");
    await expect(
      indexImportSource(asBucket(bucket), { ...params, cursor: 1 })
    ).rejects.toThrow("invalid_import_params");
    expect(fakeHttpEtag(bytes)).toBe(
      (await indexImportSource(asBucket(bucket), params)).sourceEtag
    );
  });
  test("returns Markdown content and typed UTF-8/size failures", async () => {
    const { bucket, bytes } = archive({
      "files/note.md": strToU8("# Notes"),
      "files/bad.md": new Uint8Array([0xff]),
      "files/large.md": new Uint8Array(512 * 1024 + 1),
    });
    const params = { sourceKey, sourceEtag: fakeHttpEtag(bytes) };
    expect(
      await readImportMarkdown(asBucket(bucket), {
        ...params,
        path: "files/note.md",
      })
    ).toEqual({ content: "# Notes", type: "text" });
    expect(
      await readImportMarkdown(asBucket(bucket), {
        ...params,
        path: "files/bad.md",
      })
    ).toMatchObject({ status: "failed", failureCode: "INVALID_UTF8" });
    expect(
      await readImportMarkdown(asBucket(bucket), {
        ...params,
        path: "files/large.md",
      })
    ).toMatchObject({ status: "failed", failureCode: "CONTENT_TOO_LARGE" });
  });
  test("enforces actual inflated size and never writes an oversized entry", async () => {
    const { bucket } = archive({ "files/a": strToU8("abc") });
    const directory = await readZipDirectory(asBucket(bucket), sourceKey);
    const entry = { ...directory.entries[0], uncompressedSize: 2 };
    await expect(
      readZipEntry(asBucket(bucket), sourceKey, directory, entry, 2)
    ).rejects.toBeInstanceOf(ArchiveEntryTooLargeError);
    await expect(
      extractZipEntries(asBucket(bucket), sourceKey, [
        { path: "files/a", destinationKey: "users/other/card/file/a" },
      ])
    ).rejects.toThrow("invalid_extract_entry");
    expect(bucket.puts).toHaveLength(0);
  });
  test("parses bookmark HTML and Raindrop CSV and retains per-item failures", async () => {
    for (const mode of ["bookmarks", "raindrop"] as const) {
      const text =
        mode === "bookmarks"
          ? '<DL><DT><A HREF="javascript:bad">Bad</A><DT><A HREF="https://example.com">Good</A></DL>'
          : 'url,title,note\njavascript:bad,Bad,\nhttps://example.com,Good,"A, note"';
      const bytes = strToU8(text),
        bucket = new FakeBucket();
      bucket.objects.set(sourceKey, { bytes });
      const result = await indexImportSource(asBucket(bucket), {
        sourceKey,
        mode,
        expectedSize: bytes.length,
      });
      expect(result.total).toBe(2);
      expect(result.items[0].error).toContain("unsafe");
      expect(result.items[1].card).toMatchObject({
        type: "link",
        content: "Good",
        url: "https://example.com",
      });
    }
  });
});
