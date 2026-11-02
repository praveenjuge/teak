import {
  FREE_TIER_LIMIT,
  PRO_MONTHLY_PRICE_CENTS,
  PRO_YEARLY_PRICE_CENTS,
} from "@teak/convex/shared/constants";

const SITE_URL = "https://teakvault.com";
const APP_URL = "https://app.teakvault.com";
const SITE_NAME = "Teak";
const ORGANIZATION_LOGO = `${SITE_URL}/icon.png`;
const ORGANIZATION_ID = `${SITE_URL}#organization`;

export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: SITE_NAME,
  url: SITE_URL,
  logo: {
    "@type": "ImageObject",
    url: ORGANIZATION_LOGO,
  },
  sameAs: ["https://github.com/teakvault"],
} as const;

export const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${APP_URL}/#website`,
  name: `${SITE_NAME} App`,
  url: APP_URL,
  publisher: { "@id": ORGANIZATION_ID },
} as const;

export const softwareApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${APP_URL}/#application`,
  name: SITE_NAME,
  url: APP_URL,
  applicationCategory: "DesignApplication",
  operatingSystem: "Web, iOS, macOS",
  description:
    "A personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations.",
  offers: [
    {
      "@type": "Offer",
      name: "Free Tier",
      price: "0",
      priceCurrency: "USD",
      description: `${FREE_TIER_LIMIT} cards free`,
    },
    {
      "@type": "Offer",
      name: "Pro - Monthly",
      price: String(PRO_MONTHLY_PRICE_CENTS / 100),
      priceCurrency: "USD",
      billingIncrement: "P1M",
      description: "Unlimited cards, billed monthly",
    },
    {
      "@type": "Offer",
      name: "Pro - Yearly",
      price: String(PRO_YEARLY_PRICE_CENTS / 100),
      priceCurrency: "USD",
      billingIncrement: "P1Y",
      description: "Unlimited cards, billed yearly",
    },
  ],
  featureList: [
    "Save anything in 1 click",
    "Visual bookmarking",
    "Automatic organization with smart tags",
    "Cross-platform sync",
    "Instant search",
    "Voice notes with transcription",
    "Mac library with capture and editing",
    "Chrome and Safari browser extensions",
  ],
  screenshot: `${SITE_URL}/hero-image.png`,
  author: { "@id": ORGANIZATION_ID },
  publisher: { "@id": ORGANIZATION_ID },
} as const;
