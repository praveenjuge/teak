import { describe, expect, test } from "bun:test";
import { MAX_FILE_SIZE } from "@teak/convex/shared/file-formats";
import {
  getMobileFilePreview,
  getNativeShareOptions,
  normalizeNativeFileAsset,
} from "../../lib/files";

describe("native file normalization", () => {
  test("normalizes DocumentPicker source files with filename MIME fallback", () => {
    expect(
      normalizeNativeFileAsset({
        mimeType: "application/octet-stream",
        name: "component.tsx",
        size: 512,
        uri: "file:///component.tsx",
      })
    ).toEqual({
      fileName: "component.tsx",
      fileSize: 512,
      fileUri: "file:///component.tsx",
      mimeType: "text/tsx",
    });
  });

  test("accepts every representative mobile format", () => {
    for (const fileName of [
      "readme.mdx",
      "archive.zip",
      "photo.heic",
      "vector.svg",
      "motion.gif",
      "deck.pptx",
      "design.fig",
    ]) {
      expect(
        normalizeNativeFileAsset({
          name: fileName,
          size: 1,
          uri: `file:///${fileName}`,
        })
      ).not.toBeNull();
    }
  });

  test("rejects unsupported and oversized files", () => {
    expect(
      normalizeNativeFileAsset({
        name: "animation.riv",
        size: 1,
        uri: "file:///animation.riv",
      })
    ).toBeNull();
    expect(
      normalizeNativeFileAsset({
        name: "archive.zip",
        size: MAX_FILE_SIZE + 1,
        uri: "file:///archive.zip",
      })
    ).toBeNull();
  });

  test("routes SVG and HEIC previews through thumbnails with quiet fallback", () => {
    for (const fileName of ["vector.svg", "photo.heic"]) {
      expect(
        getMobileFilePreview({
          fileName,
          fileUrl: "https://files.example/original",
          thumbnailUrl: "https://files.example/thumbnail.jpg",
        })
      ).toMatchObject({
        imageFallback: "https://files.example/thumbnail.jpg",
        imagePrimary: "https://files.example/thumbnail.jpg",
      });
    }
    expect(
      getMobileFilePreview({
        fileName: "photo.heic",
        fileUrl: "https://files.example/original",
      }).imagePrimary
    ).toBeNull();
  });

  test("routes GIF motion and exposes compact ZIP/Office/source facts", () => {
    expect(
      getMobileFilePreview({
        fileName: "motion.gif",
        fileUrl: "https://files.example/motion.gif",
      })
    ).toMatchObject({ isAnimatedGif: true });
    expect(
      getMobileFilePreview({
        fileKind: "archive",
        fileName: "bundle.zip",
        preview: { archiveDirectoryCount: 2, archiveFileCount: 4 },
      }).facts
    ).toEqual(["archive", "4 files", "2 folders"]);
    expect(
      getMobileFilePreview({
        fileKind: "office",
        fileName: "deck.pptx",
        preview: { slideCount: 3 },
      }).facts
    ).toEqual(["office", "3 slides"]);
    expect(
      getMobileFilePreview({
        fileKind: "source",
        fileLanguage: "tsx",
        fileName: "component.tsx",
      }).facts
    ).toEqual(["tsx", "source"]);
  });

  test("returns file-safe native share options across new formats", () => {
    expect(getNativeShareOptions("motion.gif")).toEqual({
      UTI: "com.compuserve.gif",
      mimeType: "image/gif",
    });
    expect(getNativeShareOptions("component.tsx")).toEqual({
      mimeType: "text/tsx",
    });
    expect(getNativeShareOptions("design.fig")).toEqual({});
  });
});
