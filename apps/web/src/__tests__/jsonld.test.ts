import { describe, expect, test } from "bun:test";
import { softwareApplicationSchema } from "@/lib/jsonld";

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
});
