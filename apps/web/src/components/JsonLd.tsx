import { serializeJsonLd } from "@teak/convex/shared/utils/jsonLd";
import type { Thing, WithContext } from "schema-dts";

type JsonLdSchema = WithContext<Thing> | WithContext<Thing>[];

interface JsonLdProps {
  schema: JsonLdSchema;
}

export function JsonLd({ schema }: JsonLdProps) {
  return (
    // A JSON-LD data block (type="application/ld+json") is not executable
    // JavaScript, so CSP script-src does not apply and no nonce is needed.
    // Adding a nonce here only causes an SSR/CSR hydration mismatch because the
    // browser blanks the nonce attribute in the DOM after load.
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: serializeJsonLd escapes `<`, so the JSON can't close the script element
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(schema) }}
      type="application/ld+json"
    />
  );
}
