import { parse } from "node-html-parser";
import { published } from "../helpers/env";
import { expect, test } from "../helpers/test";

const urlsFromXml = (xml: string) =>
  [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);

test("sitemap pages and internal links resolve", async () => {
  const index = await fetch(`${published.siteUrl}/sitemap-index.xml`).then(
    (r) => r.text()
  );
  const sitemapUrls = urlsFromXml(index);
  const pages = /<urlset[\s>]/i.test(index)
    ? sitemapUrls
    : (
        await Promise.all(
          sitemapUrls.map((url) =>
            fetch(url)
              .then((r) => r.text())
              .then(urlsFromXml)
          )
        )
      ).flat();
  expect(pages.length).toBeGreaterThan(0);
  // Every page links to the same header, footer and nav targets. Check each
  // internal target once (the status is shared) instead of once per page, so
  // the crawl costs one request per unique URL and stays inside the test
  // budget as the sitemap and the link count per page grow.
  const linkStatuses = new Map<string, Promise<number>>();
  const linkStatus = (target: string) => {
    let status = linkStatuses.get(target);
    if (!status) {
      status = fetch(target).then((response) => {
        void response.body?.cancel();
        return response.status;
      });
      linkStatuses.set(target, status);
    }
    return status;
  };
  for (const url of pages.slice(0, 80)) {
    const response = await fetch(url);
    expect(response.status, url).toBeLessThan(400);
    const html = await response.text();
    expect(parse(html).querySelector("title")?.text.trim(), url).toBeTruthy();
    const targets = parse(html)
      .querySelectorAll("a[href^='/']")
      // Cloudflare email obfuscation links resolve through client-side
      // decoding, not a real page, and 404 on a plain fetch.
      .filter((link) => !link.getAttribute("href")?.startsWith("/cdn-cgi/"))
      .slice(0, 20)
      .map((link) =>
        new URL(link.getAttribute("href")!, published.siteUrl).toString()
      );
    const statuses = await Promise.all(
      [...new Set(targets)].map(
        async (target) => [target, await linkStatus(target)] as const
      )
    );
    for (const [target, status] of statuses) {
      expect(status, `${target} linked from ${url}`).toBeLessThan(400);
    }
  }
});
