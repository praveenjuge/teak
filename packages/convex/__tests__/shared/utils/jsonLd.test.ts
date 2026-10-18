import { describe, expect, test } from "bun:test";
import { serializeJsonLd } from "../../../shared/utils/jsonLd";

describe("serializeJsonLd", () => {
  test("keeps a single schema as it is", () => {
    expect(
      JSON.parse(
        serializeJsonLd({ "@context": "https://schema.org", name: "Teak" })
      )
    ).toEqual({ "@context": "https://schema.org", name: "Teak" });
  });

  test("puts several schemas in one graph under one context", () => {
    expect(
      JSON.parse(
        serializeJsonLd([
          { "@context": "https://schema.org", "@type": "Organization" },
          { "@context": "https://schema.org", "@type": "WebPage" },
        ])
      )
    ).toEqual({
      "@context": "https://schema.org",
      "@graph": [{ "@type": "Organization" }, { "@type": "WebPage" }],
    });
  });

  test("escapes `<` so a value can't close the script element", () => {
    const serialized = serializeJsonLd({
      name: "</script><script>alert(1)</script>",
    });
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized)).toEqual({
      name: "</script><script>alert(1)</script>",
    });
  });
});
