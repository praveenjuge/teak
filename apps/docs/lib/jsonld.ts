/** Site constants and marketing-only structured data (FAQ / Product). */

export const SITE_URL = "https://teakvault.com";
export const SITE_NAME = "Teak";

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
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/icon.png`,
      },
      sameAs: [
        "https://github.com/praveenjuge/teak",
        "https://x.com/praveenjuge",
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${opts.url}/#webpage`,
      url: opts.url,
      name: opts.title,
      description: opts.description,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: { "@id": `${SITE_URL}/#organization` },
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
