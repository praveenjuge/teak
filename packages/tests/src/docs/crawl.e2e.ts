import { expect, test } from "@playwright/test";
import { parse } from "node-html-parser";
import { env } from "../helpers/env";

const urlsFromXml = (xml: string) =>
  [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);

test("sitemap pages and internal links resolve", async () => {
  const index = await fetch(`${env.siteUrl}/sitemap-index.xml`).then((r) =>
    r.text()
  );
  const sitemaps = urlsFromXml(index);
  const pages = (
    await Promise.all(
      sitemaps.map((url) =>
        fetch(url)
          .then((r) => r.text())
          .then(urlsFromXml)
      )
    )
  ).flat();
  expect(pages.length).toBeGreaterThan(0);
  for (const url of pages.slice(
    0,
    Number(process.env.PROD_E2E_DOCS_PAGE_LIMIT ?? 80)
  )) {
    const response = await fetch(url);
    expect(response.status, url).toBeLessThan(400);
    const html = await response.text();
    expect(parse(html).querySelector("title")?.text.trim(), url).toBeTruthy();
    for (const link of parse(html)
      .querySelectorAll("a[href^='/']")
      .slice(0, 20)) {
      expect(
        (await fetch(new URL(link.getAttribute("href")!, env.siteUrl))).status
      ).toBeLessThan(400);
    }
  }
});
