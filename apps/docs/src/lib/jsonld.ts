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
  logo: {
    "@type": "ImageObject",
    url: ORGANIZATION_LOGO,
  },
  sameAs: ["https://github.com/teakvault"],
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
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_URL}/docs?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
} as const;
