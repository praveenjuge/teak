export const SITE_URL = "https://teakvault.com";
export const APP_URL = "https://app.teakvault.com";
export const SITE_NAME = "Teak";
export const ORGANIZATION_LOGO = `${SITE_URL}/icon.png`;

export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: { "@type": "ImageObject", url: ORGANIZATION_LOGO },
  sameAs: ["https://github.com/praveenjuge/teak", "https://x.com/praveenjuge"],
  contactPoint: {
    "@type": "ContactPoint",
    email: "hi@praveenjuge.com",
    contactType: "Customer Support",
  },
} as const;

export const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  publisher: { "@id": `${SITE_URL}/#organization` },
} as const;

/**
 * Auto-generate common JSON-LD schemas from page metadata.
 * Replaces the old per-page manual schema builder calls.
 */
export function buildPageSchemas(opts: {
  title: string;
  description?: string;
  url: string;
  type?: "article" | "webpage";
  breadcrumbs?: { name: string; url: string }[];
  faqs?: { question: string; answer: string }[];
}) {
  const schemas: object[] = [organizationSchema, websiteSchema];

  // Article or WebPage
  if (opts.type === "article") {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "Article",
      "@id": `${opts.url}/#article`,
      headline: opts.title,
      description: opts.description,
      url: opts.url,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      author: { "@id": `${SITE_URL}/#organization` },
      publisher: { "@id": `${SITE_URL}/#organization` },
      image: `${SITE_URL}/hero-image.png`,
    });
  } else {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${opts.url}/#webpage`,
      url: opts.url,
      name: opts.title,
      description: opts.description,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: { "@id": `${SITE_URL}/#organization` },
      primaryImageOfPage: {
        "@type": "ImageObject",
        url: `${SITE_URL}/hero-image.png`,
      },
    });
  }

  // Breadcrumbs
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

  // FAQs
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
