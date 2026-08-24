import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import {
  extractRtfText,
  extractZipEntries,
  findEocd,
  inspectZipRanged,
  parseCentralDirectory,
  runInspect,
} from "./inspect";
import { FakeBucket } from "./testsupport";

describe("zip inspection over ranged reads", () => {
  const buildWordArchive = (): Uint8Array =>
    zipSync({
      "[Content_Types].xml": new TextEncoder().encode("<Types/>"),
      "word/document.xml": new TextEncoder().encode(
        "<w:body><w:p><w:t>Hello</w:t></w:p><w:p><w:t>World</w:t></w:p></w:body>"
      ),
    });

  test("counts entries and extracts docx body text", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("doc.zip", { bytes: buildWordArchive() });

    const inspection = await inspectZipRanged(bucket, "doc.zip", "word");
    expect(inspection.facts.archiveFileCount).toBe(2);
    expect(inspection.facts.archiveDirectoryCount).toBe(0);
    expect(inspection.facts.inspectedEntryCount).toBe(2);
    expect(inspection.facts.slideCount).toBeUndefined();
    expect(inspection.text).toBe("Hello World");
  });

  test("counts pptx slides without reading them for word docs", async () => {
    const bytes = zipSync({
      "ppt/slides/slide1.xml": new TextEncoder().encode("<p><t>A</t></p>"),
      "ppt/slides/slide2.xml": new TextEncoder().encode("<p><t>B</t></p>"),
      "ppt/slides/slide3.xml": new TextEncoder().encode("<p><t>C</t></p>"),
    });
    const bucket = new FakeBucket();
    bucket.objects.set("deck.pptx", { bytes });

    const pptx = await inspectZipRanged(bucket, "deck.pptx", "powerpoint");
    expect(pptx.facts.slideCount).toBe(3);
    expect(pptx.text).toBe("A\nB\nC");

    bucket.objects.set("deck.docx", { bytes });
    const asWord = await inspectZipRanged(bucket, "deck.docx", "word");
    expect(asWord.facts.slideCount).toBeUndefined();
    expect(asWord.text).toBe("");
  });

  test("reads only a bounded number of bytes for large archives", async () => {
    // A ~4MB archive whose entries are never read; the ranged walker should
    // touch just the EOCD tail + central directory.
    const bigEntry = new TextEncoder().encode("x".repeat(4 * 1024 * 1024));
    const bytes = zipSync({ "data.bin": bigEntry });
    const bucket = new FakeBucket();
    let bytesRead = 0;
    const wrappedGet = bucket.get.bind(bucket);
    (bucket as unknown as { get: typeof bucket.get }).get = (
      key: string,
      options?: { range?: { offset?: number; length?: number } }
    ): ReturnType<typeof wrappedGet> => {
      bytesRead += options?.range?.length ?? bytes.length;
      return wrappedGet(key, options);
    };
    bucket.objects.set("big.bin", { bytes });

    const inspection = await inspectZipRanged(bucket, "big.bin", "zip");
    expect(inspection.facts.archiveFileCount).toBe(1);
    expect(bytesRead).toBeLessThan(1024 * 1024);
  });

  test("throws archive_parse_failed for non-archive bytes", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("junk.bin", { bytes: new Uint8Array([1, 2, 3]) });
    await expect(inspectZipRanged(bucket, "junk.bin", "zip")).rejects.toThrow(
      "archive_parse_failed"
    );
  });
});

describe("central directory parsing primitives", () => {
  test("locates the EOCD and parses entries from the CD slice", () => {
    const bytes = zipSync({
      "a/b.txt": new TextEncoder().encode("hi"),
      "dir/": new Uint8Array(0),
      "c.xml": new TextEncoder().encode("<x/>"),
    });

    const tailLength = Math.min(bytes.length, 22 + 65_536);
    const tail = bytes.subarray(bytes.length - tailLength);
    const eocd = findEocd(tail);
    expect(eocd).not.toBeNull();
    expect(eocd!.entryCount).toBe(3);

    const cdBytes = bytes.subarray(
      eocd!.cdOffset,
      eocd!.cdOffset + eocd!.cdSize
    );
    const entries = parseCentralDirectory(cdBytes, eocd!.entryCount);
    expect(entries.map((entry) => entry.name)).toEqual([
      "a/b.txt",
      "dir/",
      "c.xml",
    ]);
    // Directory entries may legitimately sit at offset 0; real file entries
    // must point at a local header past the fixed header size.
    const textEntry = entries.find((entry) => entry.name === "c.xml");
    expect(textEntry?.localHeaderOffset ?? 0).toBeGreaterThan(0);
  });

  test("returns null when no EOCD exists in the tail", () => {
    expect(findEocd(new TextEncoder().encode("not a zip at all"))).toBeNull();
    expect(findEocd(new Uint8Array([0, 1, 2]))).toBeNull();
  });
});

describe("import archive extraction", () => {
  test("extracts requested files after 10,000 card entries", async () => {
    const files: Record<string, Uint8Array> = {};
    for (let index = 0; index < 10_002; index += 1) {
      files[`files/${index}.txt`] = new Uint8Array([index % 255]);
    }
    const bucket = new FakeBucket();
    bucket.objects.set("large-import.zip", { bytes: zipSync(files) });
    const result = await extractZipEntries(bucket, "large-import.zip", [
      {
        destinationKey: "users/u/imports/10001.txt",
        path: "files/10001.txt",
      },
    ]);
    expect(result).toHaveLength(1);
    expect(bucket.storedBytes("users/u/imports/10001.txt")).toEqual(
      new Uint8Array([10_001 % 255])
    );
  });

  test("extracts only requested entries directly into destination keys", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set("import.zip", {
      bytes: zipSync({
        "files/a.txt": new TextEncoder().encode("Alpha"),
        "files/b.txt": new TextEncoder().encode("Beta"),
      }),
    });
    const result = await extractZipEntries(bucket, "import.zip", [
      {
        contentType: "text/plain",
        destinationKey: "users/u/imports/a.txt",
        path: "files/a.txt",
      },
    ]);
    expect(result).toEqual([
      {
        bytes: 5,
        destinationKey: "users/u/imports/a.txt",
        path: "files/a.txt",
      },
    ]);
    expect(
      new TextDecoder().decode(bucket.storedBytes("users/u/imports/a.txt")!)
    ).toBe("Alpha");
    expect(bucket.storedBytes("files/b.txt")).toBeNull();
  });
});

describe("runInspect dispatch", () => {
  const bucket = new FakeBucket();

  test("css mode counts color variable declarations", async () => {
    bucket.objects.set("theme.css", {
      bytes: new TextEncoder().encode(
        ":root{--brand:#ff0000;--accent:rgb(1 2 3);--plain: red;}"
      ),
    });
    const result = await runInspect(
      bucket,
      "theme.css",
      "css",
      "tokens",
      1024,
      false
    );
    expect(result.facts?.colorVariableCount).toBe(2);
  });

  test("text mode decodes bounded text with optional rtf stripping", async () => {
    bucket.objects.set("notes.md", {
      bytes: new TextEncoder().encode("# Notes\n\nhello"),
    });
    expect(
      (await runInspect(bucket, "notes.md", "text", "markdown", 1024, false))
        .text
    ).toBe("# Notes\n\nhello");

    bucket.objects.set("notes.rtf", {
      bytes: new TextEncoder().encode(
        "{\\rtf1\\ansi{\\fonttbl}\\fs28 RTF  text, line}"
      ),
    });
    expect(
      (await runInspect(bucket, "notes.rtf", "text", "rtf", 1024, true)).text
    ).toBe("RTF text, line");
  });

  test("missing sources surface a distinct error", async () => {
    await expect(
      runInspect(bucket, "gone.css", "css", "tokens", 1024, false)
    ).rejects.toThrow("source_not_found");
  });
});

describe("rtf stripping", () => {
  test("removes control words and groups while keeping readable text", () => {
    expect(extractRtfText("{\\rtf1\\ansi Hello \\'48ello}")).not.toContain(
      "\\"
    );
    expect(extractRtfText("{\\b bold} plain")).toContain("bold");
  });
});
