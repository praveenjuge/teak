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

// Constants for reuse across the web app
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

// WebSite schema for the app
export const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${APP_URL}/#website`,
  name: `${SITE_NAME} App`,
  url: APP_URL,
  publisher: { "@id": `${SITE_URL}/#organization` },
} as const;

// SoftwareApplication schema for app listing
export const softwareApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${APP_URL}/#application`,
  name: SITE_NAME,
  url: APP_URL,
  applicationCategory: "DesignApplication",
  operatingSystem: "Web, iOS, Android, Chrome",
  description:
    "A personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations.",
  offers: [
    {
      "@type": "Offer",
      name: "Free Tier",
      price: "0",
      priceCurrency: "USD",
      description: "200 cards free",
    },
    {
      "@type": "Offer",
      name: "Pro",
      price: "19",
      priceCurrency: "USD",
      billingIncrement: "P1M",
      description: "Unlimited cards and premium features",
    },
  ],
  featureList: [
    "Save anything in 1 click",
    "Visual bookmarking",
    "Automatic organization with smart tags",
    "Cross-platform sync",
    "Instant search",
    "Voice notes with transcription",
    "Chrome extension",
  ],
  screenshot: `${SITE_URL}/hero-image.png`,
  author: { "@id": `${SITE_URL}/#organization` },
  publisher: { "@id": `${SITE_URL}/#organization` },
} as const;
