import { describe, expect, test } from "bun:test";
import {
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "@/lib/jsonld";
import { buildPageSchemas } from "../../../../docs/lib/jsonld";

describe("software application structured data", () => {
  test("describes the same Organization as the teakvault.com docs, so both sites name one entity", () => {
    const docsOrganization = buildPageSchemas({
      title: "Teak",
      url: "https://teakvault.com",
    }).find(
      (node) => (node as { "@type"?: string })["@type"] === "Organization"
    ) as Record<string, unknown>;
    for (const field of ["@id", "name", "url", "logo", "sameAs"] as const) {
      expect(organizationSchema[field]).toEqual(docsOrganization[field]);
    }
    expect(websiteSchema.publisher["@id"]).toBe(organizationSchema["@id"]);
    expect(softwareApplicationSchema.publisher["@id"]).toBe(
      organizationSchema["@id"]
    );
  });

  test("offers Free and both Pro prices from the shared billing constants", () => {
    expect(
      softwareApplicationSchema.offers.map(
        (offer) =>
          [
            offer.price,
            "billingIncrement" in offer ? offer.billingIncrement : null,
          ] as const
      )
    ).toEqual([
      ["0", null],
      ["19", "P1M"],
      ["99", "P1Y"],
    ]);
    expect(softwareApplicationSchema.offers[0].description).toBe(
      "200 cards free"
    );
  });
});
