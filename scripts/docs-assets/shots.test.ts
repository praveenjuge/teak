import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  BLOG_IMAGES,
  DOCS_IMAGES,
  HOME_SHOWCASE,
  PAGES_WITHOUT_IMAGES,
  SHOTS,
} from "./shots.ts";

const root = path.resolve(import.meta.dir, "../..");
const docsDir = path.join(root, "apps/docs/content/docs");
const imagesDir = path.join(root, DOCS_IMAGES);
const docsShots = SHOTS.filter((shot) => !shot.out);
const homeShots = SHOTS.filter((shot) => shot.out === HOME_SHOWCASE);
const blogDir = path.join(root, "apps/docs/content/blog");
const blogImagesDir = path.join(root, BLOG_IMAGES);
const blogShots = SHOTS.filter((shot) => shot.out === BLOG_IMAGES);

const pages = readdirSync(docsDir, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".mdx"))
  .map((file) => file.split(path.sep).join("/"))
  .sort();

/** Every `images/<name>.webp` a page shows, with its alt text. */
const imagesOn = (page: string) =>
  [
    ...readFileSync(path.join(docsDir, page), "utf8").matchAll(
      /!\[([^\]]*)\]\((?:\.\.?\/)images\/([^)]+)\.webp\)/g
    ),
  ].map(([, alt, name]) => ({ alt, name }));

/** Width and height from a WebP's first chunk: extended (VP8X) or lossy (VP8). */
const webpSize = (bytes: Buffer) => {
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
  }
  if (chunk === "VP8 ") {
    // 14-bit sizes; the top two bits are the scale.
    return [bytes.readUInt16LE(26) % 16_384, bytes.readUInt16LE(28) % 16_384];
  }
  throw new Error(`Unexpected WebP chunk ${chunk}`);
};

describe("docs images", () => {
  test("every page shows at least one image, unless it's listed as exempt", () => {
    const missing = pages.filter(
      (page) =>
        !PAGES_WITHOUT_IMAGES.includes(page) && imagesOn(page).length === 0
    );
    expect(missing).toEqual([]);
  });

  test("the exempt list names real pages", () => {
    expect(
      PAGES_WITHOUT_IMAGES.filter((page) => !pages.includes(page))
    ).toEqual([]);
  });

  test("every image a page shows is a shot with its alt text", () => {
    const shots = new Map(docsShots.map((shot) => [shot.name, shot.alt]));
    const wrong = pages.flatMap((page) =>
      imagesOn(page)
        .filter(({ alt, name }) => shots.get(name) !== alt)
        .map(({ name }) => `${page}: ${name}`)
    );
    expect(wrong).toEqual([]);
  });

  test("every shot is rendered and shown, and nothing else sits in images/", () => {
    const files = readdirSync(imagesDir).sort();
    expect(files).toEqual(docsShots.map((shot) => `${shot.name}.webp`).sort());
    const shown = new Set(
      pages.flatMap((page) => imagesOn(page).map(({ name }) => name))
    );
    expect(
      docsShots.filter((shot) => !shown.has(shot.name)).map((shot) => shot.name)
    ).toEqual([]);
  });

  test("alt texts have no brackets, which would end a Markdown image's alt early", () => {
    expect(
      SHOTS.filter((shot) => /[[\]]/.test(shot.alt)).map((shot) => shot.name)
    ).toEqual([]);
  });

  test("shot names are unique and every file is a 1600 × 1000 WebP", () => {
    expect(new Set(SHOTS.map((shot) => shot.name)).size).toBe(SHOTS.length);
    for (const shot of docsShots) {
      const file = path.join(imagesDir, `${shot.name}.webp`);
      expect(existsSync(file)).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
      expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
      expect(webpSize(bytes)).toEqual([1600, 1000]);
    }
  });

  test("the home page shows every showcase capture, with its alt text and size", () => {
    const showcase = readFileSync(
      path.join(root, "apps/docs/components/HomeFeatureShowcase.astro"),
      "utf8"
    );
    for (const shot of homeShots) {
      const bytes = readFileSync(
        path.join(root, HOME_SHOWCASE, `${shot.name}.webp`)
      );
      const [width, height] = webpSize(bytes);
      expect(showcase).toContain(
        `imageAlt:\n      ${JSON.stringify(shot.alt)},\n    imageHeight: ${height},\n    imageSrc: "/home-showcase/${shot.name}.webp",\n    imageWidth: ${width},`
      );
    }
  });
});

describe("blog images", () => {
  const posts = readdirSync(blogDir)
    .filter((file) => file.endsWith(".mdx"))
    .sort();
  const sourceOf = (post: string) =>
    readFileSync(path.join(blogDir, post), "utf8");
  /**
   * Every image a post shows, with where it comes from: its own
   * (`./images/<name>.webp`), a docs one (`../docs/images/<name>.webp`), or
   * neither, which no post may use.
   */
  const imagesOnPost = (post: string) =>
    [...sourceOf(post).matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].map(
      ([, alt, src]) => {
        const match = /^(\.\/images|\.\.\/docs\/images)\/([^/]+)\.webp$/.exec(
          src
        );
        return { alt, blog: match?.[1] === "./images", name: match?.[2], src };
      }
    );

  test("every image a post shows comes from the pipeline", () => {
    const wrong = posts.flatMap((post) =>
      imagesOnPost(post)
        .filter(({ name }) => !name)
        .map(({ src }) => `${post}: ${src}`)
    );
    expect(wrong).toEqual([]);
  });

  test("every post opens with its cover, the image named after it", () => {
    const wrong = posts.filter((post) => {
      // The first line of the body, after the frontmatter.
      const body = sourceOf(post).split(/^---$/m).slice(2).join("---");
      const first = body.split("\n").find((line) => line.trim());
      const slug = post.replace(/\.mdx$/, "");
      return !first
        ?.trim()
        .match(new RegExp(`^!\\[[^\\]]*\\]\\(\\./images/${slug}\\.webp\\)$`));
    });
    expect(wrong).toEqual([]);
  });

  test("every image a post shows is a shot with its alt text", () => {
    const blog = new Map(blogShots.map((shot) => [shot.name, shot.alt]));
    const docs = new Map(docsShots.map((shot) => [shot.name, shot.alt]));
    const wrong = posts.flatMap((post) =>
      imagesOnPost(post)
        .filter(
          ({ alt, blog: own, name }) =>
            name && (own ? blog : docs).get(name) !== alt
        )
        .map(({ name }) => `${post}: ${name}`)
    );
    expect(wrong).toEqual([]);
  });

  test("every blog shot has its own colored backdrop instead of the meadow", () => {
    expect(
      blogShots.filter((shot) => !shot.backdrop).map((shot) => shot.name)
    ).toEqual([]);
    const backdrops = blogShots.map((shot) => shot.backdrop?.join());
    expect(new Set(backdrops).size).toBe(backdrops.length);
  });

  test("every blog shot is rendered and shown, and nothing else sits in its images/", () => {
    const files = readdirSync(blogImagesDir).sort();
    expect(files).toEqual(blogShots.map((shot) => `${shot.name}.webp`).sort());
    const shown = new Set(
      posts.flatMap((post) =>
        imagesOnPost(post)
          .filter(({ blog }) => blog)
          .map(({ name }) => name)
      )
    );
    expect(
      blogShots.filter((shot) => !shown.has(shot.name)).map((shot) => shot.name)
    ).toEqual([]);
    for (const shot of blogShots) {
      const bytes = readFileSync(path.join(blogImagesDir, `${shot.name}.webp`));
      expect(webpSize(bytes)).toEqual([1600, 1000]);
    }
  });
});
