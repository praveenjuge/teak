import { Metadata } from "next";
import PricingPageClient from "./PricingPageClient";

export const metadata: Metadata = {
  title: "Pricing - Simple, Fair, Transparent | Teak",
  description:
    "Choose the perfect plan for your needs. Start free with open source, upgrade for advanced features, or self-host for complete control. No hidden fees, no surprises.",
  keywords:
    "teak pricing, free productivity app, open source knowledge management, self-hosted option, affordable productivity tools",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "Teak Pricing - Fair & Transparent",
    description:
      "Start free, upgrade when ready. Transparent pricing for every type of user.",
    type: "website",
    url: "https://teakvault.com/pricing",
  },
  twitter: {
    card: "summary_large_image",
    title: "Teak Pricing - Fair & Transparent", 
    description:
      "Start free, upgrade when ready. Transparent pricing for every type of user.",
  },
  robots: {
    index: true,
    follow: true,
  },
};


export default function PricingPage() {
  return <PricingPageClient />;
}