import { describe, expect, test } from "bun:test";
import {
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "@/lib/jsonld";
import { ORGANIZATION_ID as DOCS_ORGANIZATION_ID } from "../../../../docs/lib/jsonld";

describe("software application structured data", () => {
  test("advertises supported platforms, the Mac library, and browser extensions", () => {
    expect(softwareApplicationSchema.operatingSystem).toContain("macOS");
    expect(softwareApplicationSchema.operatingSystem).not.toContain("Android");
    expect(softwareApplicationSchema.featureList).toContain(
      "Mac library with capture and editing"
    );
    expect(softwareApplicationSchema.featureList).toContain(
      "Chrome and Safari browser extensions"
    );
  });

  test("names the same Organization as the teakvault.com docs, so both sites describe one entity", () => {
    expect(organizationSchema["@id"]).toBe(DOCS_ORGANIZATION_ID);
    expect(websiteSchema.publisher["@id"]).toBe(DOCS_ORGANIZATION_ID);
    expect(softwareApplicationSchema.publisher["@id"]).toBe(
      DOCS_ORGANIZATION_ID
    );
  });
});
