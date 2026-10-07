import { describe, expect, test } from "bun:test";
import { buildPageSchemas, SITE_DESCRIPTION, SITE_URL } from "./jsonld";

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
      "@id": `${SITE_URL}/#organization`,
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

    expect(page?.about).toEqual({ "@id": `${SITE_URL}/#organization` });
  });
});
