import { Metadata } from "next";
import PricingPageClient from "./PricingPageClient";

export const metadata: Metadata = {
  title: "Simple Pricing for Designers | Teak",
  description:
    "Start free with 25 cards. Upgrade to Pro for unlimited inspiration. Self-host for free. No tricks, no hidden fees.",
  keywords:
    "design bookmarking pricing, visual inspiration tool, designer subscription, creative workflow pricing",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "Simple Pricing for Designers",
    description:
      "Start free with 25 cards. Upgrade to Pro for unlimited inspiration. Self-host for free.",
    type: "website",
    url: "https://teakvault.com/pricing",
  },
  twitter: {
    card: "summary_large_image",
    title: "Simple Pricing for Designers",
    description:
      "Start free with 25 cards. Upgrade to Pro for unlimited inspiration. Self-host for free.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function PricingPage() {
  return <PricingPageClient />;
}
