import { describe, expect, test } from "bun:test";
import {
  isLinkedInPostUrl,
  mapLinkedInOpenGraph,
} from "../../linkMetadata/linkedin";

const POST_URL =
  "https://www.linkedin.com/posts/janedoe_design-activity-7100000000000000000-abcd";

describe("isLinkedInPostUrl", () => {
  test.each([
    POST_URL,
    "https://www.linkedin.com/feed/update/urn:li:activity:7100000000000000000/",
  ])("matches %s", (url: string) => {
    expect(isLinkedInPostUrl(url)).toBe(true);
  });

  test.each([
    "https://www.linkedin.com/in/janedoe",
    "https://www.linkedin.com/feed/",
    "https://www.linkedin.com/company/teak",
    "https://example.com/posts/janedoe_design",
  ])("ignores %s", (url: string) => {
    expect(isLinkedInPostUrl(url)).toBe(false);
  });
});

describe("mapLinkedInOpenGraph", () => {
  test("reads the author from an 'on LinkedIn' title", () => {
    const post = mapLinkedInOpenGraph(POST_URL, {
      title: "Jane Doe on LinkedIn: Shipping a design system in 6 weeks",
      description:
        "Shipping a design system in 6 weeks. Here is what we learned.",
      imageUrl: "https://media.licdn.com/dms/image/post.jpg",
      publishedAt: "2026-10-01T09:00:00.000Z",
    });

    expect(post).toMatchObject({
      title: "Shipping a design system in 6 weeks. Here is what we learned.",
      description: "Jane Doe on LinkedIn · October 1, 2026",
      author: "Jane Doe",
      publishedAt: "2026-10-01T09:00:00.000Z",
      platform: "linkedin",
      categoryHint: "social_post",
      media: [
        { type: "image", url: "https://media.licdn.com/dms/image/post.jpg" },
      ],
    });
  });

  test("reads the author from a pipe-separated title", () => {
    const post = mapLinkedInOpenGraph(POST_URL, {
      title: "Shipping a design system | Jane Doe | 12 comments",
      description: "Shipping a design system.",
    });

    expect(post?.author).toBe("Jane Doe");
  });

  test("uses the title as the text when the page has no description", () => {
    const post = mapLinkedInOpenGraph(POST_URL, {
      title: "Jane Doe on LinkedIn: Hello",
    });

    expect(post?.title).toBe("Jane Doe on LinkedIn: Hello");
  });

  test("keeps no inline image", () => {
    const post = mapLinkedInOpenGraph(POST_URL, {
      description: "Hello",
      imageUrl: "data:image/png;base64,AAAA",
    });

    expect(post?.media).toBeUndefined();
  });

  test("returns null without any text", () => {
    expect(mapLinkedInOpenGraph(POST_URL, {})).toBeNull();
  });
});
