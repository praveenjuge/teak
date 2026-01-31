import type { Thing, WithContext } from "schema-dts";

type JsonLdSchema = WithContext<Thing> | WithContext<Thing>[];

interface JsonLdProps {
  schema: JsonLdSchema;
}

/**
 * Server-rendered JSON-LD structured data component for SEO.
 * Uses @graph pattern when combining multiple schemas.
 */
export function JsonLd({ schema }: JsonLdProps) {
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

  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD requires script injection, content is safely JSON.stringify'd
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      type="application/ld+json"
    />
  );
}

// Constants for reuse across the docs site
export const SITE_URL = "https://teakvault.com";
export const APP_URL = "https://app.teakvault.com";
export const SITE_NAME = "Teak";
export const ORGANIZATION_LOGO = `${SITE_URL}/icon.png`;

// Shared Organization schema
export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: {
    "@type": "ImageObject",
    url: ORGANIZATION_LOGO,
  },
  sameAs: ["https://github.com/teakvault"],
} as const;

// Shared WebSite schema with search action
export const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  publisher: { "@id": `${SITE_URL}/#organization` },
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_URL}/docs?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
} as const;
