/**
 * Live link check for the link fetcher (manual; it uses the real internet).
 *
 *   bun run fetcher:live-check [links.json]
 *
 * Builds the fetcher the way its Dockerfile does, starts it locally, and runs
 * every link through what production does: fetch the page with Convex's
 * pinned fetch, read its static preview metadata, Instagram and X media, then
 * send each preview asset to the fetcher. It also follows the newest items on
 * a few design listings (Dribbble, Behance, Awwwards, ...). Prints one line per
 * link and a summary; a skipped asset shows the fetcher's reason.
 *
 * Results depend on where it runs: many sites refuse data-centre addresses, so
 * a refused *page* is about the network, not the fetcher. Asset lines are the
 * fetcher's behaviour.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isInstagramPostUrl } from "../../../../packages/convex/linkMetadata/instagram";
import { extractInstagramMediaFromHtml } from "../../../../packages/convex/linkMetadata/instagramHtml";
import { parseLinkPreview } from "../../../../packages/convex/linkMetadata/parsing";
import { SCRAPE_ELEMENTS } from "../../../../packages/convex/linkMetadata/selectors";
import {
  readBodyWithLimit,
  safeFetch,
} from "../../../../packages/convex/linkMetadata/ssrf";
import { buildSelectorResultsFromHtml } from "../../../../packages/convex/linkMetadata/staticHtml";
import { normalizeUrl } from "../../../../packages/convex/linkMetadata/url";
import {
  fetchXStatusMetadata,
  isXStatusUrl,
} from "../../../../packages/convex/linkMetadata/x";
import { FETCHER_HEADERS, FETCHER_PATH } from "../src/protocol";

const PORT = 18_080;
const FETCHER = `http://127.0.0.1:${PORT}${FETCHER_PATH}`;
const CONCURRENCY = 6;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const resolveDns = async (hostname: string) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(
    (record) => record.address
  );

interface Asset {
  fallbackContentType?: string;
  kind: "image" | "video";
  pageUrl?: string;
  role: string;
  url: string;
}

interface Checked {
  assets: string[];
  group: string;
  page: string;
  url: string;
}

const DIRECT_ASSET = /\.(png|jpe?g|gif|webp|avif|svg|mp4|mov|m4v)(?:[?#]|$)/i;

interface Listing {
  name: string;
  pattern: RegExp;
  url: string;
}

const LISTINGS: Listing[] = [
  {
    name: "dribbble",
    pattern: /href="(\/shots\/\d+-[^"?#]+)"/g,
    url: "https://dribbble.com/shots/popular",
  },
  {
    name: "behance",
    pattern: /href="(https:\/\/www\.behance\.net\/gallery\/\d+\/[^"?#]+)"/g,
    url: "https://www.behance.net/galleries",
  },
  {
    name: "awwwards",
    pattern: /href="(\/sites\/[a-z0-9-]+)"/g,
    url: "https://www.awwwards.com/websites/",
  },
  {
    name: "unsplash",
    pattern: /href="(\/photos\/[a-zA-Z0-9-]+)"/g,
    url: "https://unsplash.com/",
  },
  {
    name: "figma community",
    pattern: /href="(\/community\/file\/\d+[^"?#]*)"/g,
    url: "https://www.figma.com/community",
  },
  {
    name: "codepen",
    pattern: /href="(https:\/\/codepen\.io\/[^/"]+\/pen\/[A-Za-z0-9]+)"/g,
    url: "https://codepen.io/trending",
  },
  {
    name: "coolors",
    pattern: /href="(\/palette\/[0-9a-f-]+)"/g,
    url: "https://coolors.co/palettes/trending",
  },
  {
    name: "fonts in use",
    pattern: /href="(https:\/\/fontsinuse\.com\/uses\/\d+\/[^"?#]+)"/g,
    url: "https://fontsinuse.com/",
  },
  {
    name: "it's nice that",
    pattern: /href="(\/articles\/[a-z0-9-]+-\d+)"/g,
    url: "https://www.itsnicethat.com/",
  },
];

const discover = async (
  listing: string,
  pattern: RegExp
): Promise<string[]> => {
  try {
    const response = await fetch(listing, {
      headers: { "user-agent": USER_AGENT },
    });
    const found = new Set<string>();
    for (const match of (await response.text()).matchAll(pattern)) {
      found.add(new URL(match[1] ?? match[0], listing).toString());
      if (found.size >= 3) {
        break;
      }
    }
    return [...found];
  } catch {
    return [];
  }
};

const sendToFetcher = async (asset: Asset): Promise<string> => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(FETCHER, {
      body: JSON.stringify({
        kind: asset.kind,
        url: asset.url,
        ...(asset.fallbackContentType
          ? { fallbackContentType: asset.fallbackContentType }
          : {}),
        ...(asset.pageUrl ? { pageUrl: asset.pageUrl } : {}),
      }),
      method: "POST",
    });
    if (response.status === 503) {
      await Bun.sleep(500);
      continue;
    }
    if (response.ok) {
      const size = (await response.arrayBuffer()).byteLength;
      const width = response.headers.get(FETCHER_HEADERS.width);
      const height = response.headers.get(FETCHER_HEADERS.height);
      return `ok ${response.headers.get(FETCHER_HEADERS.contentType)}${
        width ? ` ${width}x${height}` : ""
      } ${Math.round(size / 1024)} KB`;
    }
    const body = (await response.json().catch(() => ({}))) as {
      reason?: string;
      status?: number;
    };
    return `skipped ${body.reason ?? response.status}${body.status ? ` ${body.status}` : ""}`;
  }
  return "skipped fetcher_busy";
};

const assetsFor = async (
  url: string
): Promise<{ assets: Asset[]; page: string }> => {
  if (DIRECT_ASSET.test(url)) {
    const kind = /\.(mp4|mov|m4v)(?:[?#]|$)/i.test(url) ? "video" : "image";
    return { assets: [{ kind, role: "asset", url }], page: "direct asset" };
  }
  if (isXStatusUrl(url)) {
    const status = await fetchXStatusMetadata(url);
    const assets: Asset[] = [];
    for (const media of status?.media ?? []) {
      assets.push({
        fallbackContentType: media.contentType,
        kind: media.type,
        pageUrl: status?.finalUrl,
        role: `x ${media.type}`,
        url: media.url,
      });
      if (media.type === "video" && media.posterUrl) {
        assets.push({
          fallbackContentType: media.posterContentType,
          kind: "image",
          pageUrl: status?.finalUrl,
          role: "x poster",
          url: media.posterUrl,
        });
      }
    }
    if (!assets.length && status?.imageUrl) {
      assets.push({
        kind: "image",
        pageUrl: status.finalUrl,
        role: "preview",
        url: status.imageUrl,
      });
    }
    return { assets, page: status ? "x status" : "x status unavailable" };
  }
  const response = await safeFetch(url, resolveDns, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": USER_AGENT,
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!(response.ok && contentType.includes("text/html"))) {
    await response.body?.cancel().catch(() => undefined);
    return { assets: [], page: `page ${response.status} ${contentType}` };
  }
  // As production does: the page's URL after redirects goes along as the
  // asset's page, for the fetcher's Referer.
  const pageUrl = response.url || url;
  const html = new TextDecoder().decode(
    await readBodyWithLimit(response, MAX_HTML_BYTES)
  );
  const parsed = parseLinkPreview(
    url,
    buildSelectorResultsFromHtml(html, SCRAPE_ELEMENTS)
  );
  const assets: Asset[] = [];
  const instagram = isInstagramPostUrl(url)
    ? extractInstagramMediaFromHtml(url, html)
    : undefined;
  for (const media of instagram ?? []) {
    assets.push({
      fallbackContentType: media.contentType,
      kind: media.type,
      pageUrl,
      role: `instagram ${media.type}`,
      url: media.url,
    });
  }
  if (parsed.imageUrl) {
    assets.push({
      kind: "image",
      pageUrl,
      role: "preview",
      url: parsed.imageUrl,
    });
  }
  return {
    assets,
    page: assets.length
      ? "page 200"
      : "page 200, no static preview image (production tries Browser Run)",
  };
};

const check = async (group: string, raw: string): Promise<Checked> => {
  const url = normalizeUrl(raw);
  try {
    const { assets, page } = await assetsFor(url);
    const lines: string[] = [];
    for (const asset of assets) {
      lines.push(`${asset.role}: ${await sendToFetcher(asset)}`);
    }
    return { assets: lines, group, page, url };
  } catch (error) {
    return {
      assets: [],
      group,
      page: `page error: ${(error as Error).message}`.slice(0, 140),
      url,
    };
  }
};

const startFetcher = async (): Promise<ChildProcess> => {
  const out = join(mkdtempSync(join(tmpdir(), "teak-fetcher-")), "fetcher.mjs");
  const build = Bun.spawnSync([
    "bun",
    "build",
    join(import.meta.dir, "../src/server.ts"),
    "--target=node",
    "--outfile",
    out,
  ]);
  if (build.exitCode !== 0) {
    throw new Error(build.stderr.toString());
  }
  const server = spawn("node", [out], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "inherit",
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) {
        return server;
      }
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(200);
  }
  server.kill();
  throw new Error("fetcher did not start");
};

const main = async () => {
  const groups = JSON.parse(
    readFileSync(
      process.argv[2] ?? join(import.meta.dir, "live-check-links.json"),
      "utf8"
    )
  ) as Record<string, string[]>;
  for (const { name, pattern, url } of LISTINGS) {
    const found = await discover(url, pattern);
    groups[`design: newest on ${name}`] = found.length ? found : [url];
  }
  const jobs = Object.entries(groups).flatMap(([group, urls]) =>
    urls.map((url) => [group, url] as const)
  );
  const server = await startFetcher();
  const results: Checked[] = [];
  let next = 0;
  try {
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < jobs.length) {
          const [group, url] = jobs[next++] as readonly [string, string];
          results.push(await check(group, url));
        }
      })
    );
  } finally {
    server.kill();
  }
  results.sort(
    (left, right) =>
      left.group.localeCompare(right.group) || left.url.localeCompare(right.url)
  );
  for (const result of results) {
    console.log(`[${result.group}] ${result.url}\n  ${result.page}`);
    for (const line of result.assets) {
      console.log(`  ${line}`);
    }
  }
  const assetLines = results.flatMap((result) => result.assets);
  console.log(
    `\n${results.length} links, ${assetLines.length} assets: ${
      assetLines.filter((line) => line.includes(": ok ")).length
    } stored, ${assetLines.filter((line) => line.includes(": skipped")).length} skipped`
  );
};

await main();
