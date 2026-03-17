import type { Metadata } from "next";
import type { Thing, WithContext } from "schema-dts";
import {
  JsonLd,
  organizationSchema,
  SITE_URL,
} from "../../../components/JsonLd";
import PricingPageClient from "./PricingPageClient";

export const metadata: Metadata = {
  title: "200 Cards Free. $19/month After. No Tricks.",
  description:
    "Try Teak free with 200 cards. Pro is $19/month - less than 2 coffees. Or self-host for free. Simple pricing.",
  keywords:
    "design bookmarking pricing, visual inspiration tool, designer subscription, creative workflow pricing",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "200 Cards Free. $19/month After. No Tricks.",
    description:
      "Try Teak free with 200 cards. Pro is $19/month - less than 2 coffees. Or self-host for free.",
    type: "website",
    url: "https://teakvault.com/pricing",
    siteName: "Teak",
    locale: "en_US",
    images: [
      {
        url: "/hero-image.png",
        width: 1200,
        height: 630,
        alt: "Teak - Pricing",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "200 Cards Free. $19/month After. No Tricks.",
    description:
      "Try Teak free with 200 cards. Pro is $19/month - less than 2 coffees. Or self-host for free.",
    images: ["/hero-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "https://teakvault.com/pricing",
  },
};

// Breadcrumb schema for pricing page
const breadcrumbSchema = {
  "@context": "https://schema.org" as const,
  "@type": "BreadcrumbList" as const,
  itemListElement: [
    {
      "@type": "ListItem" as const,
      position: 1,
      name: "Home",
      item: SITE_URL,
    },
    {
      "@type": "ListItem" as const,
      position: 2,
      name: "Pricing",
      item: `${SITE_URL}/pricing`,
    },
  ],
};

// Product schema for Teak Pro subscription
const productSchema = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Teak Pro",
  description:
    "Unlimited visual bookmarking for designers and developers. Save inspiration in 1 click, find it in 2 seconds.",
  brand: {
    "@type": "Brand",
    name: "Teak",
  },
  offers: [
    {
      "@type": "Offer",
      name: "Teak Pro - Monthly",
      price: "19.00",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/pricing`,
      priceValidUntil: new Date(
        new Date().setFullYear(new Date().getFullYear() + 1)
      ).toISOString(),
    },
    {
      "@type": "Offer",
      name: "Teak Pro - Yearly",
      price: "99.00",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/pricing`,
      priceValidUntil: new Date(
        new Date().setFullYear(new Date().getFullYear() + 1)
      ).toISOString(),
    },
  ],
} as WithContext<Thing>;

export default function PricingPage() {
  return (
    <>
      <JsonLd schema={[organizationSchema, productSchema, breadcrumbSchema]} />
      <PricingPageClient />
    </>
  );
}
