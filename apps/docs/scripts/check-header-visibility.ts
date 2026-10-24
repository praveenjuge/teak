#!/usr/bin/env bun
// Fails the build when a page ships the header's Login, Register and
// "Open Teak" links without what shows only one set (lib/header-visibility.ts).

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { headerVisibilityProblems } from "../lib/header-visibility";

const DIST = join(import.meta.dir, "../dist");

const htmlFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return htmlFiles(path);
    }
    return entry.name.endsWith(".html") ? [path] : [];
  });

const stylesheets = new Map<string, string>();
const stylesheet = (href: string): string => {
  const cached = stylesheets.get(href);
  if (cached !== undefined) {
    return cached;
  }
  let css = "";
  try {
    css = readFileSync(join(DIST, href.split(/[?#]/)[0] ?? ""), "utf-8");
  } catch {
    // An external or missing stylesheet hides nothing.
  }
  stylesheets.set(href, css);
  return css;
};

const pageCss = (html: string): string =>
  [
    ...[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(
      (match) => match[1] ?? ""
    ),
    ...[...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].flatMap(
      (match) => {
        const href = /href="(\/[^"]+)"/.exec(match[0])?.[1];
        return href ? [stylesheet(href)] : [];
      }
    ),
  ].join("\n");

let checked = 0;
const failures: string[] = [];
for (const file of htmlFiles(DIST)) {
  const html = readFileSync(file, "utf-8");
  const problems = headerVisibilityProblems(html, pageCss(html));
  if (html.includes("data-signed-in-only")) {
    checked += 1;
  }
  for (const problem of problems) {
    failures.push(`${relative(DIST, file)}: ${problem}`);
  }
}

if (failures.length > 0) {
  console.error(
    `The header would show Login, Register and Open Teak together:\n${failures.join("\n")}`
  );
  process.exit(1);
}
if (checked === 0) {
  console.error("No built page has the header; is dist/ empty?");
  process.exit(1);
}
console.log(`Header links: ${checked} pages show one set.`);
