import { describe, expect, test } from "bun:test";
import {
  extractDocumentFileText,
  FILES_INSPECT_MAX_ARCHIVE_BYTES,
  type FilesInspectParams,
  linkOcrSourceKeys,
} from "./inspect";
import { FILES_UPLOAD_MAX_BYTES } from "./storage";

const recordingInspect = (
  outcome:
    | { kind: "ok"; data: { facts?: Record<string, number>; text?: string } }
    | { kind: "fallback" }
) => {
  const calls: FilesInspectParams[] = [];
  return {
    calls,
    inspect: (params: FilesInspectParams) => {
      calls.push(params);
      return Promise.resolve(outcome);
    },
  };
};

describe("extractDocumentFileText", () => {
  test("reads a Word file as a zip archive", async () => {
    const { calls, inspect } = recordingInspect({
      kind: "ok",
      data: { text: "Minutes" },
    });
    const result = await extractDocumentFileText(
      inspect,
      "k",
      { id: "word", kind: "document" },
      {}
    );
    expect(result).toEqual({ text: "Minutes" });
    expect(calls[0]).toMatchObject({
      maxBytes: FILES_INSPECT_MAX_ARCHIVE_BYTES,
      mode: "zip",
    });
  });

  test("reads a PDF's text and page count up to the upload size", async () => {
    const { calls, inspect } = recordingInspect({
      kind: "ok",
      data: { facts: { pageCount: 3 }, text: "Paper" },
    });
    const result = await extractDocumentFileText(
      inspect,
      "k",
      { id: "pdf", kind: "pdf" },
      {}
    );
    expect(result).toEqual({ pageCount: 3, text: "Paper" });
    expect(calls[0]).toMatchObject({
      maxBytes: FILES_UPLOAD_MAX_BYTES,
      mode: "pdf",
    });
  });

  test("asks nothing for a format without text", async () => {
    const { calls, inspect } = recordingInspect({ kind: "fallback" });
    const result = await extractDocumentFileText(
      inspect,
      "k",
      { id: "png", kind: "image" },
      {}
    );
    expect(result).toEqual({ text: "" });
    expect(calls).toEqual([]);
  });

  test("reads a declined document as no text", async () => {
    const { inspect } = recordingInspect({ kind: "fallback" });
    expect(
      await extractDocumentFileText(
        inspect,
        "k",
        { id: "markdown", kind: "markdown" },
        {}
      )
    ).toEqual({ text: "" });
  });
});

describe("linkOcrSourceKeys", () => {
  test("reads the preview image, then the screenshot", () => {
    expect(
      linkOcrSourceKeys({
        imageStorageKey: "og",
        screenshotStorageKey: "shot",
      })
    ).toEqual(["og", "shot"]);
  });

  test("reads only the images a preview has", () => {
    expect(linkOcrSourceKeys({ screenshotStorageKey: "shot" })).toEqual([
      "shot",
    ]);
    expect(linkOcrSourceKeys(undefined)).toEqual([]);
  });
});
