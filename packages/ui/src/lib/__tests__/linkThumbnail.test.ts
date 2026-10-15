import { describe, expect, test } from "bun:test";
import {
  firstFile,
  imageFromClipboard,
  isTextEntryTarget,
  linkThumbnailErrorMessage,
  linkThumbnailFileProblem,
} from "../linkThumbnail";

const MB = 1024 * 1024;

describe("link image files", () => {
  test.each([
    [{ type: "image/png", size: 5 * MB }, null],
    [{ type: "image/jpeg", size: 20 * MB }, null],
    [{ type: "image/gif", size: 1 }, null],
    [{ type: "image/jpeg", size: 20 * MB + 1 }, "Images must be under 20 MB."],
    [
      { type: "image/svg+xml", size: 1 },
      "Use a JPEG, PNG, WebP, GIF or AVIF image.",
    ],
    [
      { type: "image/heic", size: 1 },
      "Use a JPEG, PNG, WebP, GIF or AVIF image.",
    ],
    [
      { type: "text/plain", size: 1 },
      "Use a JPEG, PNG, WebP, GIF or AVIF image.",
    ],
  ])("%o is refused with %p", (file, problem) => {
    expect(linkThumbnailFileProblem(file)).toBe(problem);
  });

  test("a drop of several files takes the first", () => {
    const a = new File(["a"], "a.png", { type: "image/png" });
    const b = new File(["b"], "b.png", { type: "image/png" });
    expect(firstFile([a, b])).toBe(a);
    expect(firstFile([])).toBeUndefined();
  });

  test("a paste gives its first image, from files or items", () => {
    const text = new File(["t"], "t.txt", { type: "text/plain" });
    const image = new File(["i"], "i.png", { type: "image/png" });
    expect(imageFromClipboard({ files: [text, image], items: [] } as any)).toBe(
      image
    );
    expect(
      imageFromClipboard({
        files: [],
        items: [
          { kind: "string", type: "text/plain", getAsFile: () => null },
          { kind: "file", type: "image/webp", getAsFile: () => image },
        ],
      } as any)
    ).toBe(image);
    expect(imageFromClipboard({ files: [text], items: [] } as any)).toBe(
      undefined
    );
  });
});

describe("link image errors", () => {
  test.each([
    ["UNSUPPORTED_TYPE", "Use a JPEG, PNG, WebP, GIF or AVIF image."],
    ["FILE_TOO_LARGE", "Images must be under 20 MB."],
    ["INVALID_INPUT", "This image couldn't be read."],
    ["RATE_LIMITED", "You've changed a lot of images. Try again in a minute."],
  ])("%s reads as the problem, never the file", (code, message) => {
    expect(
      linkThumbnailErrorMessage({ data: { code, message: "raw.png failed" } })
    ).toBe(message);
  });

  test("other errors fall back to a plain message", () => {
    expect(linkThumbnailErrorMessage(new Error("network"))).toBe(
      "Couldn't change the image. Try again."
    );
  });
});

describe("paste targets", () => {
  const element = (tagName: string, extra: Record<string, unknown> = {}) =>
    ({ tagName, closest: () => null, ...extra }) as unknown as EventTarget;

  test.each([
    ["INPUT", true],
    ["TEXTAREA", true],
    ["DIV", false],
    ["BUTTON", false],
  ])("a paste into a %s belongs to it: %p", (tagName, expected) => {
    expect(isTextEntryTarget(element(tagName))).toBe(expected);
  });

  test("the note editor keeps its paste", () => {
    expect(isTextEntryTarget(element("P", { isContentEditable: true }))).toBe(
      true
    );
    expect(isTextEntryTarget(element("SPAN", { closest: () => ({}) }))).toBe(
      true
    );
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
