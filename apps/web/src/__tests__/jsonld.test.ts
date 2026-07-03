import { describe, expect, test } from "bun:test";
import { softwareApplicationSchema } from "@/lib/jsonld";

describe("software application structured data", () => {
  test("advertises macOS and both browser extensions", () => {
    expect(softwareApplicationSchema.operatingSystem).toContain("macOS");
    expect(softwareApplicationSchema.featureList).toContain(
      "Chrome and Safari browser extensions"
    );
  });
});
