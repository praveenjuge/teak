import { Metadata } from "next";
import PricingPageClient from "./PricingPageClient";

export const metadata: Metadata = {
  title: "25 Cards Free. $19/month After. No Tricks. | Teak",
  description:
    "Try Teak free with 25 cards. Pro is $19/month - less than 2 coffees. Or self-host for free. Simple pricing.",
  keywords:
    "design bookmarking pricing, visual inspiration tool, designer subscription, creative workflow pricing",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "25 Cards Free. $19/month After. No Tricks.",
    description:
      "Try Teak free with 25 cards. Pro is $19/month - less than 2 coffees. Or self-host for free.",
    type: "website",
    url: "https://teakvault.com/pricing",
  },
  twitter: {
    card: "summary_large_image",
    title: "25 Cards Free. $19/month After. No Tricks.",
    description:
      "Try Teak free with 25 cards. Pro is $19/month - less than 2 coffees. Or self-host for free.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function PricingPage() {
  return <PricingPageClient />;
}
