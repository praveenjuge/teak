import { afterEach, describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { validateFileFormat } from "../../shared/fileFormats";
import {
  buildFilePreviewFacts,
  extractFileTextForAi,
  inspectZip,
} from "../../workflows/fileProcessing";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const responseFor = (bytes: Uint8Array, contentType: string) =>
  new Response(Uint8Array.from(bytes).buffer, {
    headers: {
      "content-length": String(bytes.byteLength),
      "content-type": contentType,
    },
  });

describe("file processing", () => {
  test("inspects ZIP manifests without extracting child cards", async () => {
    const bytes = zipSync({
      "assets/": new Uint8Array(),
      "assets/icon.svg": strToU8("<svg />"),
      "readme.txt": strToU8("hello"),
    });

    const result = await inspectZip(
      bytes,
      validateFileFormat({
        fileName: "bundle.zip",
        mimeType: "application/zip",
      })
    );

    expect(result.facts).toMatchObject({
      archiveDirectoryCount: 1,
      archiveFileCount: 2,
      inspectedEntryCount: 3,
    });
    expect(result.text).toBe("");
  });

  test("extracts bounded DOCX text transiently and stores only counts as facts", async () => {
    const bytes = zipSync({
      "[Content_Types].xml": strToU8("<Types />"),
      "word/document.xml": strToU8(
        "<w:document><w:body><w:p><w:t>Private design brief</w:t></w:p></w:body></w:document>"
      ),
    });
    const format = validateFileFormat({
      fileName: "brief.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const result = await inspectZip(bytes, format);

    expect(result.text).toBe("Private design brief");
    expect(JSON.stringify(result.facts)).not.toContain("Private design brief");
  });

  test("counts PPTX slides and extracts their text for AI only", async () => {
    const bytes = zipSync({
      "ppt/slides/slide1.xml": strToU8("<a:t>Title</a:t>"),
      "ppt/slides/slide2.xml": strToU8("<a:t>Details</a:t>"),
    });
    const format = validateFileFormat({
      fileName: "deck.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    const result = await inspectZip(bytes, format);

    expect(result.facts.slideCount).toBe(2);
    expect(result.text).toContain("Title");
    expect(result.text).toContain("Details");
  });

  test("extracts source text without persisting it in preview facts", async () => {
    const source = strToU8("export const secret = 'transient';");
    globalThis.fetch = (() =>
      Promise.resolve(responseFor(source, "text/tsx"))) as typeof fetch;
    const format = validateFileFormat({
      fileName: "component.tsx",
      mimeType: "text/tsx",
    });

    await expect(
      extractFileTextForAi("https://files.example/source", format, {
        fileKey: "source",
        fileMetadata: { fileName: "component.tsx", kind: "source" },
      })
    ).resolves.toContain("transient");
    await expect(
      buildFilePreviewFacts("https://files.example/source", format)
    ).resolves.toBeNull();
  });

  test("stores only the count of obvious CSS color custom properties", async () => {
    const source = strToU8(
      ":root { --brand: #ff0000; --space: 8px; --surface: oklch(1 0 0); }"
    );
    globalThis.fetch = (() =>
      Promise.resolve(responseFor(source, "text/css"))) as typeof fetch;
    const format = validateFileFormat({
      fileName: "theme.css",
      mimeType: "text/css",
    });

    await expect(
      buildFilePreviewFacts("https://files.example/theme", format)
    ).resolves.toEqual({ colorVariableCount: 2 });
  });
});
