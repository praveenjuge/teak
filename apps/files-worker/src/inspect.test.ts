import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { extractRtfText, inspectZipInMemory, runInspect } from "./inspect";
import { FakeBucket } from "./testsupport";

describe("zip inspection", () => {
  test("counts entries and extracts docx body text", () => {
    const bytes = zipSync({
      "[Content_Types].xml": new TextEncoder().encode("<Types/>"),
      "word/document.xml": new TextEncoder().encode(
        "<w:body><w:p><w:t>Hello</w:t></w:p><w:p><w:t>World</w:t></w:p></w:body>"
      ),
    });

    const inspection = inspectZipInMemory(bytes, "word");
    expect(inspection).not.toBeNull();
    expect(inspection!.facts.archiveFileCount).toBe(2);
    expect(inspection!.facts.archiveDirectoryCount).toBe(0);
    expect(inspection!.facts.inspectedEntryCount).toBe(2);
    expect(inspection!.facts.slideCount).toBeUndefined();
    expect(inspection!.text).toBe("Hello World");
  });

  test("counts pptx slides without reading them for word docs", () => {
    const bytes = zipSync({
      "ppt/slides/slide1.xml": new TextEncoder().encode("<p><t>A</t></p>"),
      "ppt/slides/slide2.xml": new TextEncoder().encode("<p><t>B</t></p>"),
      "ppt/slides/slide3.xml": new TextEncoder().encode("<p><t>C</t></p>"),
    });

    const pptx = inspectZipInMemory(bytes, "powerpoint");
    expect(pptx!.facts.slideCount).toBe(3);
    expect(pptx!.text).toBe("A\nB\nC");

    const asWord = inspectZipInMemory(bytes, "word");
    expect(asWord!.facts.slideCount).toBeUndefined();
    expect(asWord!.text).toBe("");
  });

  test("returns null for non-archive bytes", () => {
    expect(inspectZipInMemory(new Uint8Array([1, 2, 3]), "zip")).toBeNull();
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
