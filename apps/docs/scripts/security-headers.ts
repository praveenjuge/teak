import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Sent with every response from teakvault.com. Blume has no option for custom
// headers, so the build adds this rule to the `_headers` file it writes for
// Cloudflare. CORS stays open, as it was on Vercel, so browser agents and other
// sites can read the Markdown, llms.txt and OpenAPI files.
export const SITE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

interface Rule {
  lines: string[];
  path: string;
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
export function withSiteHeaders(file: string): string {
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

  rules.push({
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
  const file = path.join(import.meta.dir, "..", "dist", "_headers");
  writeFileSync(file, withSiteHeaders(readFileSync(file, "utf8")));
  console.log("Added the site-wide headers to dist/_headers");
}
