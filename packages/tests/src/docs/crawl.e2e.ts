import { readDocsHtml } from "../helpers/docs-html";
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
    const { title, internalLinks } = readDocsHtml(html);
    expect(title, url).toBeTruthy();
    const targets = internalLinks.map((href) =>
      new URL(href, published.siteUrl).toString()
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
