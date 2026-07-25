import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import type * as yauzl from "yauzl";
import {
  ArchiveEntryTooLargeError,
  entryBuffer,
} from "../../import/archiveZip";

const entry = (fileName: string, uncompressedSize: number) =>
  ({ fileName, uncompressedSize }) as yauzl.Entry;

describe("entryBuffer", () => {
  test("uses a typed error when declared entry size exceeds the limit", async () => {
    const zip = {} as yauzl.ZipFile;

    await expect(entryBuffer(zip, entry("note.md", 3), 2)).rejects.toEqual(
      new ArchiveEntryTooLargeError("note.md is too large")
    );
  });

  test("uses a typed error when streamed content exceeds the limit", async () => {
    const zip = {
      openReadStream(
        _entry: yauzl.Entry,
        callback: (error: Error | null, stream?: Readable) => void
      ) {
        callback(null, Readable.from([Buffer.from("abc")]));
      },
    } as unknown as yauzl.ZipFile;

    await expect(
      entryBuffer(zip, entry("note.md", 2), 2)
    ).rejects.toBeInstanceOf(ArchiveEntryTooLargeError);
  });

  test("preserves non-size archive read failures", async () => {
    const failure = new Error("ZIP entry is corrupt");
    const zip = {
      openReadStream(
        _entry: yauzl.Entry,
        callback: (error: Error | null, stream?: Readable) => void
      ) {
        callback(failure);
      },
    } as unknown as yauzl.ZipFile;

    await expect(entryBuffer(zip, entry("note.md", 2), 2)).rejects.toBe(
      failure
    );
  });
});
