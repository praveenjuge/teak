import { Metadata } from "next";
import PricingPageClient from "./PricingPageClient";

export const metadata: Metadata = {
  title: "Pricing - For Designers & Developers | Teak",
  description:
    "Choose the perfect plan for your visual bookmarking needs. Start free, upgrade for unlimited cards, or self-host for complete control. No hidden fees.",
  keywords:
    "teak pricing, visual bookmarking tool, design inspiration management, creative bookmarking, designer tools, developer resources",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "Teak Pricing - For Designers & Developers",
    description:
      "Start free, upgrade when ready. Transparent pricing for designers and developers.",
    type: "website",
    url: "https://teakvault.com/pricing",
  },
  twitter: {
    card: "summary_large_image",
    title: "Teak Pricing - For Designers & Developers",
    description:
      "Start free, upgrade when ready. Transparent pricing for designers and developers.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function PricingPage() {
  return <PricingPageClient />;
}
