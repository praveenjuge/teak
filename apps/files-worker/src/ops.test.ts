import { describe, expect, test } from "bun:test";
import { getFilesOpObjectKey } from "./ops";

describe("getFilesOpObjectKey", () => {
  test.each([
    [{ key: "users/u/cards/c/file/a.png" }, "users/u/cards/c/file/a.png"],
    [{ sourceKey: "source.zip" }, "source.zip"],
    [{ archiveKey: "archive.zip" }, "archive.zip"],
    [{ artifactKey: "export.zip" }, "export.zip"],
    [{ manifestKey: "manifest.json" }, "manifest.json"],
    [{ keys: ["first.png", "second.png"] }, "first.png"],
    [{}, ""],
    [null, ""],
    [undefined, ""],
  ] as const)("extracts %p", (params, expected) => {
    expect(getFilesOpObjectKey(params)).toBe(expected);
  });
});
