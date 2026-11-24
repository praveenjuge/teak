import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SITE_HEADERS } from "../lib/siteHeaders";

export { SITE_HEADERS } from "../lib/siteHeaders";

const ATTRIBUTES = {
  as: /\sas="([^"]*)"/,
  href: /\shref="([^"]*)"/,
  rel: /\srel="([^"]*)"/,
  type: /\stype="([^"]*)"/,
} as const;

const attribute = (tag: string, name: keyof typeof ATTRIBUTES) =>
  tag.match(ATTRIBUTES[name])?.[1];

// One page's font and stylesheets as `Link` preload values, which Early Hints
// sends before the page itself.
function pagePreloads(html: string): string[] {
  const links: string[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    const rel = attribute(tag, "rel");
    const href = attribute(tag, "href");
    if (!href?.startsWith("/")) {
      continue;
    }
    if (rel === "stylesheet") {
      links.push(`<${href}>; rel=preload; as=style`);
    } else if (rel === "preload" && attribute(tag, "as") === "font") {
      const type = attribute(tag, "type");
      links.push(
        `<${href}>; rel=preload; as=font${type ? `; type="${type}"` : ""}; crossorigin`
      );
    }
  }
  return links;
}

/**
 * The preloads every styled page shares, in the first page's order. Redirect
 * stubs load nothing, so they don't count.
 */
export function sharedPreloads(pages: string[]): string[] {
  const [first, ...rest] = pages
    .map(pagePreloads)
    .filter((links) => links.length > 0);
  return (first ?? []).filter((link) =>
    rest.every((links) => links.includes(link))
  );
}

export interface Rule {
  lines: string[];
  path: string;
}

/**
 * One `Link` rule per top-level section (`/docs*`, `/blog*`) and one for the
 * home page, each with the preloads that section's pages share. A rule per
 * page would pass Cloudflare's limit of 100 rules.
 */
export function preloadRules(pages: { html: string; path: string }[]): Rule[] {
  const sections = new Map<string, string[]>();
  for (const { html, path: page } of pages) {
    const section = page === "/" ? "/" : `/${page.split("/")[1]}*`;
    sections.set(section, [...(sections.get(section) ?? []), html]);
  }
  return [...sections]
    .map(([section, htmls]) => ({
      path: section,
      lines: [sharedPreloads(htmls)].flatMap((links) =>
        links.length > 0 ? [`Link: ${links.join(", ")}`] : []
      ),
    }))
    .filter((rule) => rule.lines.length > 0);
}

function parseRules(file: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of file.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    if (/^\s/.test(line)) {
      rules.at(-1)?.lines.push(line.trim());
    } else {
      rules.push({ path: line.trim(), lines: [] });
    }
  }
  return rules;
}

// Cloudflare joins a header that several matching rules set with a comma, and
// `*, *` is not a valid CORS value. A narrower rule that repeats one of these
// headers with the same value is redundant under `/*`, so drop the repeat.
export function withSiteHeaders(file: string, preloads: Rule[] = []): string {
  const site = new Set(
    Object.entries(SITE_HEADERS).map(
      ([name, value]) => `${name.toLowerCase()}: ${value}`
    )
  );
  const rules = parseRules(file)
    .map((rule) => ({
      ...rule,
      lines: rule.lines.filter((line) => {
        const [name, ...value] = line.split(":");
        return !site.has(
          `${name.trim().toLowerCase()}: ${value.join(":").trim()}`
        );
      }),
    }))
    .filter((rule) => rule.lines.length > 0);

  rules.push(...preloads, {
    path: "/*",
    lines: Object.entries(SITE_HEADERS).map(
      ([name, value]) => `${name}: ${value}`
    ),
  });

  return `${rules
    .map((rule) =>
      [rule.path, ...rule.lines.map((line) => `  ${line}`)].join("\n")
    )
    .join("\n")}\n`;
}

if (import.meta.main) {
  const dist = path.join(import.meta.dir, "..", "dist");
  const pages = readdirSync(dist, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".html"))
    .map((name) => ({
      html: readFileSync(path.join(dist, name), "utf8"),
      path: `/${name.replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "")}`,
    }));
  const preloads = preloadRules(pages);
  const file = path.join(dist, "_headers");
  writeFileSync(file, withSiteHeaders(readFileSync(file, "utf8"), preloads));
  console.log(
    `Added the site-wide headers and ${preloads.length} Early Hints rules to dist/_headers`
  );
}
