import type { Thing, WithContext } from "schema-dts";

type JsonLdSchema = WithContext<Thing> | WithContext<Thing>[];

interface JsonLdProps {
  nonce?: string;
  schema: JsonLdSchema;
}

/**
 * Server-rendered JSON-LD structured data component for SEO.
 * Uses @graph pattern when combining multiple schemas.
 */
export function JsonLd({ nonce, schema }: JsonLdProps) {
  const jsonLd = Array.isArray(schema)
    ? {
        "@context": "https://schema.org",
        "@graph": schema.map((item) => {
          const { "@context": _, ...rest } = item as unknown as Record<
            string,
            unknown
          >;
          return rest;
        }),
      }
    : schema;

  // Escape `<` so a value containing `</script>` (or `<`) cannot break out of
  // the script element and inject markup.
  const serialized = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD requires script injection, content is JSON.stringify'd and `<` is escaped
      dangerouslySetInnerHTML={{ __html: serialized }}
      nonce={nonce}
      type="application/ld+json"
    />
  );
}
