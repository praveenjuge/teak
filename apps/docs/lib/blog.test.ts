import { describe, expect, test } from "bun:test";
import {
  blogAuthors,
  formatPostDate,
  isBlogPost,
  postSlug,
  sortPosts,
} from "./blog";

describe("blog helpers", () => {
  test("only dated, published blog pages are posts", () => {
    expect(isBlogPost({ type: "blog", date: "2026-10-27" })).toBe(true);
    expect(isBlogPost({ type: "blog", date: "2026-10-27", draft: true })).toBe(
      false
    );
    expect(isBlogPost({ type: "blog" })).toBe(false);
    expect(isBlogPost({ type: "changelog", date: "2026-10-27" })).toBe(false);
  });

  test("authors read as a list from a name, an object or a mix", () => {
    expect(blogAuthors(undefined)).toEqual([]);
    expect(blogAuthors("Praveen Juge")).toEqual([{ name: "Praveen Juge" }]);
    expect(
      blogAuthors([
        { name: "Praveen Juge", url: "https://x.com/praveenjuge" },
        "Guest",
      ])
    ).toEqual([
      { name: "Praveen Juge", url: "https://x.com/praveenjuge" },
      { name: "Guest" },
    ]);
  });

  test("dates print in UTC, so a YAML date keeps its day", () => {
    expect(formatPostDate("2026-10-01")).toBe("October 1, 2026");
    expect(formatPostDate(new Date("2026-10-27T00:00:00Z"))).toBe(
      "October 27, 2026"
    );
  });

  test("a post's slug is the last part of its path", () => {
    expect(postSlug("/blog/why-we-built-teak")).toBe("why-we-built-teak");
    expect(postSlug("/blog/why-we-built-teak/")).toBe("why-we-built-teak");
  });

  test("posts sort newest first, then by title", () => {
    const sorted = sortPosts([
      { date: "2026-10-20", title: "B" },
      { date: "2026-10-27", title: "C" },
      { date: "2026-10-20", title: "A" },
    ]);
    expect(sorted.map((post) => post.title)).toEqual(["C", "A", "B"]);
  });
});
