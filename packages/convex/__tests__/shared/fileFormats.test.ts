import { describe, expect, test } from "bun:test";
import {
  FILE_FORMATS,
  FileFormatValidationError,
  fileUploadErrorCode,
  inferFileFormat,
  MAX_FILE_SIZE,
  mimeTypeForFileName,
  validateFileFormat,
  validateFileName,
  validateUploadFile,
} from "../../shared/fileFormats";

const REQUIRED_FILE_NAMES = [
  "data.json",
  "theme.tokens.json",
  "tailwind.config.js",
  "theme.css",
  "variables.css",
  "component.tsx",
  "component.jsx",
  "component.vue",
  "component.svelte",
  "index.html",
  "styles.css",
  "motion.gif",
  "motion.webm",
  "motion.mp4",
  "document.pdf",
  "document.docx",
  "slides.pptx",
  "notes.txt",
  "notes.rtf",
  "readme.md",
  "readme.mdx",
  "image.webp",
  "image.avif",
  "image.svg",
  "image.heic",
  "design.fig",
  "archive.zip",
] as const;

describe("file format registry", () => {
  for (const fileName of REQUIRED_FILE_NAMES) {
    test(`supports ${fileName}`, () => {
      expect(inferFileFormat({ fileName })).not.toBeNull();
    });
  }

  test("keeps format identifiers unique", () => {
    const ids = FILE_FORMATS.map((format) => format.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("recognizes compound and special filenames before simple extensions", () => {
    expect(inferFileFormat({ fileName: "brand.tokens.json" })).toMatchObject({
      id: "design-tokens",
      kind: "tokens",
    });
    expect(inferFileFormat({ fileName: "tailwind.config.js" })).toMatchObject({
      id: "tailwind-config",
      language: "javascript",
    });
    expect(inferFileFormat({ fileName: "THEME.CSS" })).toMatchObject({
      id: "css-variables",
      kind: "tokens",
    });
  });

  test("normalizes uppercase extensions and MIME parameters", () => {
    expect(
      validateFileFormat({
        fileName: "COMPONENT.TSX",
        mimeType: "text/typescript; charset=utf-8",
      })
    ).toMatchObject({ cardType: "document", language: "tsx" });
  });

  test("uses filename inference for missing and generic MIME types", () => {
    expect(validateFileFormat({ fileName: "photo.avif" }).cardType).toBe(
      "image"
    );
    expect(
      validateFileFormat({
        fileName: "slides.pptx",
        mimeType: "application/octet-stream",
      }).kind
    ).toBe("office");
    expect(mimeTypeForFileName("component.vue")).toBe("text/x-vue");
  });

  test("treats animated GIF files as video-like motion", () => {
    expect(
      validateFileFormat({ fileName: "demo.gif", mimeType: "image/gif" })
    ).toMatchObject({ cardType: "video", kind: "motion" });
  });

  test("classifies WebM audio recordings as audio cards", () => {
    expect(
      validateFileFormat({
        fileName: "recording_1730000000.webm",
        mimeType: "audio/webm",
      })
    ).toMatchObject({ cardType: "audio", id: "webm-audio", kind: "audio" });
    expect(
      inferFileFormat({
        fileName: "recording_1730000000.webm",
        mimeType: "audio/webm;codecs=opus",
      })
    ).toMatchObject({ cardType: "audio", id: "webm-audio" });
    expect(
      inferFileFormat({ fileName: "voice-memo", mimeType: "audio/webm" })
    ).toMatchObject({ cardType: "audio" });
  });

  test("keeps WebM video files as motion cards", () => {
    expect(
      validateFileFormat({ fileName: "clip.webm", mimeType: "video/webm" })
    ).toMatchObject({ cardType: "video", id: "webm", kind: "motion" });
    expect(inferFileFormat({ fileName: "clip.webm" })).toMatchObject({
      cardType: "video",
      id: "webm",
    });
    expect(() =>
      validateFileFormat({ fileName: "clip.webm", mimeType: "image/png" })
    ).toThrow("does not match");
  });

  test("classifies MP4 audio files as audio cards", () => {
    expect(
      validateFileFormat({ fileName: "voice.mp4", mimeType: "audio/mp4" })
    ).toMatchObject({ cardType: "audio", id: "mp4-audio" });
    expect(
      validateFileFormat({
        fileName: "voice.m4a",
        mimeType: "audio/x-m4a",
      }).cardType
    ).toBe("audio");
    expect(inferFileFormat({ fileName: "movie.mp4" })).toMatchObject({
      cardType: "video",
      id: "mp4",
    });
  });

  test("accepts common MIME variants", () => {
    expect(
      validateFileFormat({
        fileName: "notes.md",
        mimeType: "text/x-markdown",
      }).id
    ).toBe("markdown");
    expect(
      validateFileFormat({
        fileName: "NOTES.MarkDown",
        mimeType: "text/plain",
      }).cardType
    ).toBe("text");
    expect(
      validateFileFormat({
        fileName: "notes.mdx",
        mimeType: "text/markdown",
      }).cardType
    ).toBe("document");
    expect(
      inferFileFormat({
        fileName: "notes.txt",
        mimeType: "text/markdown",
      })
    ).toBeNull();
    expect(
      inferFileFormat({
        fileName: "attachment",
        mimeType: "text/markdown",
      })?.cardType
    ).toBe("document");
    expect(
      validateFileFormat({
        fileName: "archive.zip",
        mimeType: "application/x-zip-compressed",
      }).id
    ).toBe("zip");
    expect(
      validateFileFormat({
        fileName: "photo.jpg",
        mimeType: "image/pjpeg",
      }).id
    ).toBe("jpeg");
    expect(
      validateFileFormat({
        fileName: "windows-export.csv",
        mimeType: "application/vnd.ms-excel",
      }).id
    ).toBe("csv");
  });

  test("maps validation failures to canonical public upload codes", () => {
    expect(
      fileUploadErrorCode(
        new FileFormatValidationError("MIME_MISMATCH", "mismatch")
      )
    ).toBe("TYPE_MISMATCH");
    expect(
      fileUploadErrorCode(
        new FileFormatValidationError("FILE_TOO_LARGE", "too large")
      )
    ).toBe("FILE_TOO_LARGE");
    expect(
      fileUploadErrorCode(
        new FileFormatValidationError("INVALID_MIME_TYPE", "invalid")
      )
    ).toBe("INVALID_INPUT");
  });

  test("rejects extension and MIME mismatches", () => {
    expect(() =>
      validateFileFormat({ fileName: "photo.png", mimeType: "video/mp4" })
    ).toThrow("does not match");
  });

  for (const fileName of ["deck.key", "animation.riv", "unknown.xyz"]) {
    test(`rejects excluded or unknown file ${fileName}`, () => {
      expect(inferFileFormat({ fileName })).toBeNull();
      expect(() => validateFileFormat({ fileName })).toThrow(
        "Unsupported file type"
      );
    });
  }

  for (const fileName of [
    "../secret.json",
    "..\\secret.json",
    "bad\u0000.json",
    "..",
  ]) {
    test(`rejects dangerous filename ${fileName}`, () => {
      expect(() => validateFileName(fileName)).toThrow("safe characters");
    });
  }

  test("enforces the 100MB boundary", () => {
    expect(MAX_FILE_SIZE).toBe(100 * 1024 * 1024);
    expect(
      validateUploadFile({
        fileName: "archive.zip",
        fileSize: MAX_FILE_SIZE,
        mimeType: "application/zip",
      }).format.id
    ).toBe("zip");
    expect(() =>
      validateUploadFile({
        fileName: "archive.zip",
        fileSize: MAX_FILE_SIZE + 1,
        mimeType: "application/zip",
      })
    ).toThrow(`${MAX_FILE_SIZE}`);
  });

  test("classifies non-positive and non-finite sizes as invalid input", () => {
    for (const fileSize of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      try {
        validateUploadFile({
          fileName: "notes.txt",
          fileSize,
          mimeType: "text/plain",
        });
        throw new Error("Expected validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(FileFormatValidationError);
        expect(fileUploadErrorCode(error as FileFormatValidationError)).toBe(
          "INVALID_INPUT"
        );
      }
    }
  });
});
