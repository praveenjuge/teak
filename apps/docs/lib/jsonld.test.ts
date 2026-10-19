import { describe, expect, test } from "bun:test";
import { AUDIENCE_PAGES, buildAudiencePageSchemas } from "./audience-pages";
import {
  buildPageSchemas,
  ORGANIZATION_ID,
  SITE_DESCRIPTION,
  SITE_URL,
} from "./jsonld";

interface SchemaNode {
  "@type": string;
  [key: string]: unknown;
}

const organization = (schemas: object[]) =>
  (schemas as SchemaNode[]).find((node) => node["@type"] === "Organization");

describe("marketing structured data", () => {
  const schemas = buildPageSchemas({
    title: "Pricing | Teak",
    url: `${SITE_URL}/pricing`,
  });

  test("Organization carries identity fields agents read", () => {
    expect(organization(schemas)).toMatchObject({
      "@id": ORGANIZATION_ID,
      name: "Teak",
      url: SITE_URL,
      description: SITE_DESCRIPTION,
    });
  });

  test("Organization description is a real sentence, not a placeholder", () => {
    expect(SITE_DESCRIPTION.length).toBeGreaterThan(40);
    expect(SITE_DESCRIPTION).toStartWith("Teak is");
  });

  test("every page links back to the Organization", () => {
    const page = (schemas as SchemaNode[]).find(
      (node) => node["@type"] === "WebPage"
    );

    expect(page?.about).toEqual({ "@id": ORGANIZATION_ID });
  });
});

describe("audience page structured data", () => {
  const page = AUDIENCE_PAGES["save-without-filing"];
  const schemas = buildAudiencePageSchemas(page) as SchemaNode[];
  const byType = (type: string) =>
    schemas.find((node) => node["@type"] === type);

  test("FAQ schema lists every question with a plain-text answer", () => {
    const faq = byType("FAQPage");
    const entries = faq?.mainEntity as {
      "@type": string;
      name: string;
      acceptedAnswer: { "@type": string; text: string };
    }[];

    expect(entries.map((entry) => entry.name)).toEqual(
      page.faqs.map((item) => item.question)
    );
    for (const entry of entries) {
      expect(entry["@type"]).toBe("Question");
      expect(entry.acceptedAnswer["@type"]).toBe("Answer");
      expect(entry.acceptedAnswer.text).not.toContain("`");
    }
    expect(entries.map((entry) => entry.acceptedAnswer.text)).toContain(
      "Yes. Tag a card secret or hidden and it leaves your library, search, folders and Shuffle on every app. Search #secret or tag:hidden to see those cards again."
    );
  });

  test("the page and its breadcrumb point at the page's own URL", () => {
    const url = `${SITE_URL}/save-without-filing`;

    expect(byType("WebPage")).toMatchObject({ url, name: page.title });
    expect(byType("BreadcrumbList")?.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: "Save without filing",
        item: url,
      },
    ]);
  });
});
