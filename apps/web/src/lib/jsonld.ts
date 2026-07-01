// Constants for reuse across the web app's structured data
const SITE_URL = "https://teakvault.com";
const APP_URL = "https://app.teakvault.com";
const SITE_NAME = "Teak";
const ORGANIZATION_LOGO = `${SITE_URL}/icon.png`;

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
