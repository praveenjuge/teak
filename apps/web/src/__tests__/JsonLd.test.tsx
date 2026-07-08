import { describe, expect, test } from "bun:test";
import { JsonLd } from "@/components/JsonLd";

describe("JsonLd", () => {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Teak",
  } as const;

  test("renders a JSON-LD data block", () => {
    const element = JsonLd({ schema }) as {
      props: Record<string, unknown>;
    };

    expect(element.props.type).toBe("application/ld+json");
    const html = (element.props.dangerouslySetInnerHTML as { __html: string })
      .__html;
    expect(html).toContain('"@type":"Organization"');
  });

  test("does not set a nonce (regression: causes SSR/CSR hydration mismatch)", () => {
    // A JSON-LD data block is not executable, so CSP does not require a nonce.
    // Browsers blank the nonce attribute in the DOM after load, so rendering it
    // makes the client tree mismatch the server-rendered HTML on hydration.
    const element = JsonLd({ schema }) as {
      props: Record<string, unknown>;
    };

    expect(element.props.nonce).toBeUndefined();
    expect("nonce" in element.props).toBe(false);
  });

  test("escapes angle brackets to prevent script breakout", () => {
    const element = JsonLd({
      schema: {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "</script><script>alert(1)</script>",
      } as never,
    }) as { props: Record<string, unknown> };

    const html = (element.props.dangerouslySetInnerHTML as { __html: string })
      .__html;
    expect(html).not.toContain("</script>");
    expect(html).toContain("\\u003c");
  });
});
