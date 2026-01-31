import type { Metadata } from "next";
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

export default function PricingPage() {
  return <PricingPageClient />;
}
