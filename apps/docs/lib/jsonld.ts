/** Site constants and marketing-only structured data (FAQ / Product). */

export const SITE_URL = "https://teakvault.com";
export const SITE_NAME = "Teak";
export const SITE_DESCRIPTION =
  "Teak is a personal knowledge hub for saving, finding, and syncing cards across web, desktop, mobile, and agents.";
export const ORGANIZATION_LOGO = "/icon.png";
export const ORGANIZATION_SAME_AS = [
  "https://github.com/praveenjuge/teak",
  "https://x.com/praveenjuge",
];

// Blume's seo.organization and WebSite nodes use these ids on docs pages, so
// marketing pages reference the same entities instead of duplicating them.
export const ORGANIZATION_ID = `${SITE_URL}#organization`;
const WEBSITE_ID = `${SITE_URL}#website`;

/**
 * FAQ / WebPage graph for marketing pages. Docs pages rely on Blume's built-in
 * structuredData instead of this helper.
 */
export function buildPageSchemas(opts: {
  title: string;
  description?: string;
  url: string;
  breadcrumbs?: { name: string; url: string }[];
  faqs?: { question: string; answer: string }[];
}) {
  const schemas: object[] = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}${ORGANIZATION_LOGO}`,
      },
      sameAs: ORGANIZATION_SAME_AS,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${opts.url}/#webpage`,
      url: opts.url,
      name: opts.title,
      description: opts.description,
      isPartOf: { "@id": WEBSITE_ID },
      about: { "@id": ORGANIZATION_ID },
    },
  ];

  if (opts.breadcrumbs?.length) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: opts.breadcrumbs.map((item, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: item.name,
        item: item.url,
      })),
    });
  }

  if (opts.faqs?.length) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: opts.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  }

  return schemas;
}

export function buildProductSchema(
  name: string,
  description: string,
  offers: {
    name: string;
    price: string;
    priceCurrency?: string;
  }[]
) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description,
    brand: { "@type": "Brand", name: SITE_NAME },
    offers: offers.map((offer) => ({
      "@type": "Offer",
      name: offer.name,
      price: offer.price,
      priceCurrency: offer.priceCurrency ?? "USD",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/pricing`,
    })),
  };
}
