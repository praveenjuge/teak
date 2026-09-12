import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { indexImportSource, readImportMarkdown } from "./importSource";
import { FakeBucket, fakeHttpEtag } from "./testsupport";
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
