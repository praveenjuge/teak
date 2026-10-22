/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  assetSaveFor,
  isWebPageFile,
  pickSelectedText,
  savesLinkInstead,
} from "../../lib/contextMenuContent";
import { downloadAssetFile } from "../../lib/saveFileToTeak";

describe("context menu content", () => {
  test("Save Asset keeps the clicked media and marks a plain link", () => {
    expect(
      assetSaveFor({
        linkUrl: "https://example.com/post",
        srcUrl: "https://cdn.example.com/a.png",
      })
    ).toEqual({ assetUrl: "https://cdn.example.com/a.png" });
    expect(assetSaveFor({ linkUrl: "https://example.com/post" })).toEqual({
      assetUrl: "https://example.com/post",
      link: true,
    });
    expect(assetSaveFor({})).toBeNull();
  });

  test("a downloaded web page is told apart from a file", () => {
    expect(isWebPageFile({ mimeType: "text/html; charset=utf-8" })).toBe(true);
    expect(isWebPageFile({ mimeType: "application/xhtml+xml" })).toBe(true);
    expect(isWebPageFile({ mimeType: "application/pdf" })).toBe(false);
    expect(isWebPageFile({ mimeType: "text/plain" })).toBe(false);
  });

  test("a plain link saves as a link only for a page or a redirect", async () => {
    const download = (response: Response) =>
      downloadAssetFile("https://example.com/post", {
        fetchImpl: (() => Promise.resolve(response)) as unknown as typeof fetch,
      });
    expect(
      savesLinkInstead(
        await download(Response.redirect("https://example.com/next", 302))
      )
    ).toBe(true);
    expect(
      savesLinkInstead(
        await download(
          new Response("<html></html>", {
            headers: { "content-type": "text/html" },
          })
        )
      )
    ).toBe(true);
    expect(
      savesLinkInstead(await download(new Response("gone", { status: 503 })))
    ).toBe(false);
    expect(
      savesLinkInstead(
        await download(
          new Response("%PDF", {
            headers: { "content-type": "application/pdf" },
          })
        )
      )
    ).toBe(false);
  });

  test("a selection keeps the page's line breaks over the menu's flattened copy", () => {
    expect(pickSelectedText("line one\nline two", "line one line two")).toBe(
      "line one\nline two"
    );
    expect(pickSelectedText("", "only the menu's")).toBe("only the menu's");
    expect(pickSelectedText(undefined, "  ")).toBeNull();
  });
});
