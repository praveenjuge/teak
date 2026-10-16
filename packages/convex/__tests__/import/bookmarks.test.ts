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
      folders: ["Design / Tools"],
      type: "link",
      url: "https://example.com/work",
    });
    expect(parsed[0].card?.tags).toBeUndefined();
    expect(parsed[0].card).not.toHaveProperty("icon");
  });

  test("reads the TAGS attribute and leaves top-level links in no folder", () => {
    const parsed =
      parseBookmarksHtml(`<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
      <DT><A HREF="https://loose.test" TAGS="design, fonts,,design">Loose</A>
      <DT><H3>  Reading   list </H3><DL><p>
      <DT><A HREF="https://filed.test">Filed</A>
      </DL></DL>`);
    expect(parsed[0].card?.tags).toEqual(["design", "fonts"]);
    expect(parsed[0].card?.folders).toBeUndefined();
    expect(parsed[1].card?.folders).toEqual(["Reading list"]);
  });

  test("the browser's Bookmarks bar and Other bookmarks are the top level", () => {
    const parsed =
      parseBookmarksHtml(`<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
      <DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3><DL><p>
        <DT><A HREF="https://bar.test">On the bar</A>
        <DT><H3>Work</H3><DL><p><DT><A HREF="https://work.test">Work link</A></DL>
      </DL>
      <DT><H3 UNFILED_BOOKMARKS_FOLDER="true">Other Bookmarks</H3><DL><p>
        <DT><A HREF="https://other.test">Other</A>
      </DL>
    </DL>`);
    expect(parsed.map((item) => item.card?.folders)).toEqual([
      undefined,
      ["Work"],
      undefined,
    ]);
  });

  test("reads an export with hundreds of sibling folders", () => {
    let html = "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n";
    for (let index = 0; index < 600; index++) {
      html += `<DT><H3>Folder ${index}</H3>\n<DL><p>\n<DT><A HREF="https://cap.test/${index}">Link ${index}</A>\n</DL><p>\n`;
    }
    const parsed = parseBookmarksHtml(`${html}</DL><p>`);
    expect(parsed).toHaveLength(600);
    expect(parsed[599]?.card?.folders).toEqual(["Folder 599"]);
  });

  test("still refuses folders nested more than 128 deep", () => {
    const html = `<DL>${"<DT><H3>x</H3><DL>".repeat(130)}`;
    expect(() => parseBookmarksHtml(html)).toThrow("nesting exceeds");
  });

  test("flattens six levels of nesting into one folder path", () => {
    const depth = ["A", "B", "C", "D", "E", "F"];
    const open = depth.map((name) => `<DT><H3>${name}</H3><DL><p>`).join("");
    const close = depth.map(() => "</DL>").join("");
    const parsed = parseBookmarksHtml(
      `<DL><p>${open}<DT><A HREF="https://deep.test">Deep</A>${close}</DL>`
    );
    expect(parsed[0].card?.folders).toEqual(["A / B / C / D / E / F"]);
  });

  test("rejects unsafe bookmark URLs without stopping valid items", () => {
    const parsed = parseBookmarksHtml(
      `<DL><DT><A HREF="javascript:alert(1)">Bad</A><DT><A HREF="https://safe.test">Safe</A></DL>`
    );
    expect(parsed[0].error).toContain("unsafe");
    expect(parsed[1].card?.url).toBe("https://safe.test");
  });
});
