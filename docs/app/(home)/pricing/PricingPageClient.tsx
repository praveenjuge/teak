"use client";

import { useState } from "react";
import { PricingCard } from "../../../components/PricingCard";
import { PricingToggle } from "../../../components/PricingToggle";
import { Button } from "../../../components/ui/button";

const pricingPlans = [
  {
    id: "free",
    name: "Free",
    price: "Free",
    description:
      "200 cards go further than you think. Your most important inspiration, completely free.",
    features: [
      "200 cards",
      "Find anything in 2 seconds",
      "Works on phone, laptop, tablet",
      "No credit card, ever",
      "Dark mode",
      "No ads",
      "Fully private",
      "No tracking",
    ],
    cta: {
      text: "Start Free",
      href: "https://app.teakvault.com/register",
    },
  },
  {
    id: "pro",
    name: "Pro",
    price: {
      monthly: { amount: "$19", period: "month" },
      yearly: { amount: "$99", period: "year" },
    },
    description:
      "Unlimited inspiration for the price of 2 coffees/month. Save everything, find anything.",
    features: [
      "Unlimited cards",
      "Find anything in 2 seconds",
      "Works on phone, laptop, tablet",
      "Get help in 2 hours, not 2 days",
      "Dark mode",
      "No ads",
      "Fully private",
      "No tracking",
    ],
    cta: {
      text: "Get Pro",
      href: "https://app.teakvault.com/register",
      primary: true,
    },
    popular: true,
  },
];

const selfHostedPlan = {
  name: "Self-Hosted",
  description:
    "Run Teak yourself. Unlimited cards, total control, zero cost. Perfect for agencies.",
  cta: {
    text: "Setup Guide →",
    href: "/docs",
  },
};

const faqs = [
  {
    question: "Why exactly 200 cards?",
    answer:
      "200 cards covers your most important inspiration. When you need more, Pro is just $19/month - less than 2 coffees.",
  },
  {
    question: "So... Pro or Self-hosted?",
    answer:
      "Pro: We handle all the tech stuff, you just create. Self-hosted: You handle the tech, keep it free forever. Same features, different headache level.",
  },
  {
    question: "Can I switch plans anytime?",
    answer:
      "Yep. Monthly to yearly (save 35%), upgrade, downgrade, or leave entirely. Export your data with one click. We don't do lock-in.",
  },
  {
    question: "What if I hate it?",
    answer:
      "30-day full refund. No questions, no hassle. Try Pro for a month, if you don't love it, we'll give you every penny back.",
  },
  {
    question: "Self-hosting is actually free?",
    answer:
      "100% free. MIT license, run it anywhere. Perfect for agencies who want their data to never touch our servers.",
  },
  {
    question: "What happens when I hit 200 cards?",
    answer:
      "Your 200 cards stay safe forever. You just can't add more until you go Pro or self-host. We never delete your inspiration.",
  },
];

export default function PricingPageClient() {
  const [isYearly, setIsYearly] = useState(false);

  return (
    <main className="flex flex-1 flex-col">
      {/* Hero Section */}
      <section className="pt-20 pb-8">
        <div className="container mx-auto px-4 text-center max-w-xl">
          <h1 className="mb-4 font-bold text-4xl md:text-5xl text-balance tracking-tight">
            200 cards free. $19/month after.
          </h1>
          <p className="mx-auto max-w-2xl text-muted-foreground text-lg text-balance">
            Try it free with your most important inspiration. Upgrade when you
            need more. No tricks, ever.
          </p>
        </div>
      </section>

      {/* Pricing Toggle */}
      <div className="container mx-auto px-4 pb-4">
        <PricingToggle onToggle={setIsYearly} defaultYearly={false} />
      </div>

      {/* Pricing Cards */}
      <section className="pb-12">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 md:grid-cols-2 max-w-4xl mx-auto">
            {pricingPlans.map((plan) => (
              <PricingCard
                key={plan.id}
                name={plan.name}
                price={plan.price}
                description={plan.description}
                features={plan.features}
                cta={plan.cta}
                popular={plan.popular}
                isYearly={isYearly}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Self-Hosted Section */}
      <section className="pb-20 md:pb-24">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl">
            <div className="relative rounded-lg border border-border justify-between bg-card p-8 flex">
              <div>
                <h3 className="font-semibold text-base mb-2">
                  {selfHostedPlan.name}
                </h3>
                <p className="text-muted-foreground">
                  {selfHostedPlan.description}
                </p>
              </div>
              <Button variant="outline" asChild>
                <a href={selfHostedPlan.cta.href}>{selfHostedPlan.cta.text}</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 font-bold text-3xl text-balance">FAQ</h2>
            <p className="mx-auto max-w-xl text-muted-foreground text-balance">
              Real answers. No corporate jargon, promise.
            </p>
          </div>

          <div className="mx-auto max-w-2xl space-y-4">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className="rounded-lg border border-border bg-card p-6"
              >
                <h3 className="mb-3 font-semibold text-foreground">
                  {faq.question}
                </h3>
                <p className="text-muted-foreground">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
