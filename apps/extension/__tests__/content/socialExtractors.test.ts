// @ts-nocheck
import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  extractHackerNewsPost,
  findHackerNewsPosts,
} from "../../entrypoints/content/platforms/hackernews";
import {
  extractInstagramPost,
  findInstagramPosts,
} from "../../entrypoints/content/platforms/instagram";
import {
  extractPinterestPost,
  findPinterestPosts,
} from "../../entrypoints/content/platforms/pinterest";
import {
  extractXPost,
  findXPosts,
} from "../../entrypoints/content/platforms/x";

const previousWindow = (globalThis as { window?: unknown }).window;

const setWindowOrigin = (origin: string, pathname = "/") => {
  (globalThis as { window?: unknown }).window = {
    location: { origin, pathname },
  };
};

const createAnchor = (href: string) =>
  ({
    getAttribute: (name: string) => (name === "href" ? href : null),
  }) as unknown as HTMLAnchorElement;

const createPost = (anchors: HTMLAnchorElement[]) =>
  ({
    querySelectorAll: () => anchors,
  }) as unknown as HTMLElement;

const createHackerNewsCell = ({
  href,
  storyId,
}: {
  href: string | null;
  storyId: string | null;
}) =>
  ({
    closest: () =>
      storyId === null
        ? null
        : ({
            getAttribute: (name: string) => (name === "id" ? storyId : null),
          } as unknown as HTMLElement),
    querySelector: () =>
      href === null
        ? null
        : ({
            getAttribute: (name: string) => (name === "href" ? href : null),
          } as unknown as HTMLAnchorElement),
  }) as unknown as HTMLElement;

afterEach(() => {
  (globalThis as { window?: unknown }).window = previousWindow;
});

describe("social platform extractors", () => {
  test("extracts X post permalink and key", () => {
    setWindowOrigin("https://x.com");

    const post = createPost([createAnchor("/teak/status/123456789")]);
    const extracted = extractXPost(post);

    expect(extracted).toEqual({
      platform: "x",
      permalink: "https://x.com/teak/status/123456789",
      postKey: "x:123456789",
    });
  });

  test("extracts Instagram post permalink and key", () => {
    setWindowOrigin("https://www.instagram.com");

    const post = createPost([createAnchor("/p/DBY4WfSxA0a/")]);
    const extracted = extractInstagramPost(post);

    expect(extracted).toEqual({
      platform: "instagram",
      permalink: "https://www.instagram.com/p/DBY4WfSxA0a/",
      postKey: "instagram:DBY4WfSxA0a",
    });
  });

  test("extracts Pinterest pin permalink and key", () => {
    setWindowOrigin("https://www.pinterest.com");

    const post = createPost([createAnchor("/pin/123456789012345/")]);
    const extracted = extractPinterestPost(post);

    expect(extracted).toEqual({
      platform: "pinterest",
      permalink: "https://www.pinterest.com/pin/123456789012345/",
      postKey: "pinterest:123456789012345",
    });
  });

  test("extracts Hacker News story permalink and key", () => {
    setWindowOrigin("https://news.ycombinator.com");

    const post = createHackerNewsCell({
      href: "https://example.com/story",
      storyId: "47295537",
    });
    const extracted = extractHackerNewsPost(post);

    expect(extracted).toEqual({
      platform: "hackernews",
      permalink: "https://example.com/story",
      postKey: "hackernews:47295537",
    });
  });

  test("skips Hacker News self-post rows", () => {
    setWindowOrigin("https://news.ycombinator.com");

    const post = createHackerNewsCell({
      href: "item?id=47295537",
      storyId: "47295537",
    });

    expect(extractHackerNewsPost(post)).toBeNull();
  });

  test("skips Hacker News rows without a story id", () => {
    setWindowOrigin("https://news.ycombinator.com");

    const post = createHackerNewsCell({
      href: "https://example.com/story",
      storyId: null,
    });

    expect(extractHackerNewsPost(post)).toBeNull();
  });

  test("findXPosts delegates to expected selector", () => {
    const querySelectorAll = mock(() => [{}, {}]);
    const root = { querySelectorAll } as unknown as ParentNode;

    expect(findXPosts(root).length).toBe(2);
    expect(querySelectorAll).toHaveBeenCalledWith(
      'article[data-testid="tweet"]'
    );
  });

  test("findInstagramPosts delegates to expected selector", () => {
    const querySelectorAll = mock(() => [{}]);
    const root = { querySelectorAll } as unknown as ParentNode;

    expect(findInstagramPosts(root).length).toBe(1);
    expect(querySelectorAll).toHaveBeenCalledWith("article");
  });

  test("findHackerNewsPosts delegates to expected selector", () => {
    setWindowOrigin("https://news.ycombinator.com");

    const querySelectorAll = mock(() => [{}, {}]);
    const root = { querySelectorAll } as unknown as ParentNode;

    expect(findHackerNewsPosts(root).length).toBe(2);
    expect(querySelectorAll).toHaveBeenCalledWith(
      "tr.athing > td.title:last-child"
    );
  });

  test("findHackerNewsPosts skips item detail pages", () => {
    setWindowOrigin("https://news.ycombinator.com", "/item");

    const querySelectorAll = mock(() => [{}, {}]);
    const root = { querySelectorAll } as unknown as ParentNode;

    expect(findHackerNewsPosts(root)).toEqual([]);
    expect(querySelectorAll).not.toHaveBeenCalled();
  });

  test("findPinterestPosts delegates to expected selector", () => {
    setWindowOrigin("https://www.pinterest.com");

    const pinPost = createPost([createAnchor("/pin/123456789012345/")]);
    const querySelectorAll = mock((selector: string) => {
      if (selector === '[data-test-id="pin"]') {
        return [pinPost];
      }

      if (selector === '[data-test-id="pinWrapper"]') {
        return [];
      }

      if (selector === '[data-grid-item="true"]') {
        return [];
      }

      return [];
    });
    const root = { querySelectorAll } as unknown as ParentNode;

    expect(findPinterestPosts(root).length).toBe(1);
    expect(querySelectorAll).toHaveBeenCalledWith('[data-test-id="pin"]');
    expect(querySelectorAll).toHaveBeenCalledWith(
      '[data-test-id="pinWrapper"]'
    );
    expect(querySelectorAll).toHaveBeenCalledWith('[data-grid-item="true"]');
  });

  test("findPinterestPosts deduplicates nested containers for the same pin", () => {
    setWindowOrigin("https://www.pinterest.com");

    const pinAnchor = createAnchor("/pin/123456789012345/");
    const pinElement = createPost([pinAnchor]);
    const pinWrapperElement = createPost([pinAnchor]);
    const gridItemElement = createPost([pinAnchor]);
    const querySelectorAll = mock((selector: string) => {
      if (selector === '[data-test-id="pin"]') {
        return [pinElement];
      }

      if (selector === '[data-test-id="pinWrapper"]') {
        return [pinWrapperElement];
      }

      if (selector === '[data-grid-item="true"]') {
        return [gridItemElement];
      }

      return [];
    });

    const root = { querySelectorAll } as unknown as ParentNode;

    expect(findPinterestPosts(root)).toEqual([pinElement]);
  });
});
