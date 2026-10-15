import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import config from "../blume.config";
import vercel from "../vercel.json";

const docsRoot = path.join(import.meta.dir, "..");
const blumeRedirects = config.redirects ?? [];
const vercelRedirects = vercel.redirects;

// Blume writes a wildcard as `*`; Vercel names it (`:day`).
const pattern = (source: string) => source.replace(/:\w+\*?|\*/g, "*");

const vercelTarget = (source: string) =>
  vercelRedirects.find(
    (redirect) => pattern(redirect.source) === pattern(source)
  )?.destination;

describe("blume.config.ts and the files Blume does not generate", () => {
  test.each(
    blumeRedirects.map((redirect) => [redirect.from, redirect.to] as const)
  )("Vercel serves the Blume redirect %s as an HTTP redirect", (from, to) => {
    expect(vercelTarget(from)).toBe(to);
  });

  test.each(
    blumeRedirects
      .filter(({ from }) => /^\/docs\/[^.*]+$/.test(from))
      .map((redirect) => [redirect.from, redirect.to] as const)
  )("Vercel moves the Markdown mirrors of the page redirect %s", (from, to) => {
    expect(vercelTarget(`${from}.md`)).toBe(`${to}.md`);
    expect(vercelTarget(`${from}.mdx`)).toBe(`${to}.mdx`);
  });

  test.each(vercelRedirects.map((redirect) => [redirect.source] as const))(
    "the Vercel redirect %s comes from a Blume redirect",
    (source) => {
      const page = source.replace(/(?:\/|\.mdx?)$/, "");
      const origins = new Set(
        blumeRedirects.map((redirect) => pattern(redirect.from))
      );
      expect(origins.has(pattern(source)) || origins.has(pattern(page))).toBe(
        true
      );
    }
  );

  test("marketing pages use the docs accent color", () => {
    const themeCss = readFileSync(path.join(docsRoot, "theme.css"), "utf8");
    expect(config.theme?.accent).toBe(
      themeCss.match(/--blume-accent:\s*([^;]+);/)?.[1]
    );
  });
});
