import { readFileSync } from "node:fs";

/** A recorded response from `workflows/steps/categorization/fixtures/rich-sites`. */
export const richSiteFixture = (name: string): string =>
  readFileSync(
    new URL(
      `../workflows/steps/categorization/fixtures/rich-sites/${name}`,
      import.meta.url
    ),
    "utf8"
  );

export const richSiteJson = <T = any>(name: string): T =>
  JSON.parse(richSiteFixture(name));

export const xmlResponse = (body: string, init?: ResponseInit) =>
  new Response(body, {
    status: 200,
    ...init,
    headers: { "content-type": "application/atom+xml", ...init?.headers },
  });
