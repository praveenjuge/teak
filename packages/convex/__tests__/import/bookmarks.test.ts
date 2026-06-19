import { describe, expect, test } from "bun:test";
import { parseBookmarksHtml } from "../../import/bookmarks";

describe("backend bookmark parser", () => {
  test("maps nested folders, titles, URLs, and valid dates", () => {
    const parsed =
      parseBookmarksHtml(`<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
      <DT><H3>Design</H3><DL><p><DT><H3>Tools</H3><DL><p>
      <DT><A HREF="https://example.com/work" ADD_DATE="1700000000" ICON="data:image/png;base64,nope">Example</A>
      </DL></DL></DL>`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].card).toMatchObject({
      content: "Example",
      createdAt: 1_700_000_000_000,
      tags: ["Design", "Tools"],
      type: "link",
      url: "https://example.com/work",
    });
    expect(parsed[0].card).not.toHaveProperty("icon");
  });

  test("rejects unsafe bookmark URLs without stopping valid items", () => {
    const parsed = parseBookmarksHtml(
      `<DL><DT><A HREF="javascript:alert(1)">Bad</A><DT><A HREF="https://safe.test">Safe</A></DL>`
    );
    expect(parsed[0].error).toContain("unsafe");
    expect(parsed[1].card?.url).toBe("https://safe.test");
  });
});
