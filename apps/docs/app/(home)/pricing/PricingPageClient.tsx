"use client";

import { useState } from "react";
import { Rocket, TrendingUp, Wrench } from "lucide-react";
import { PricingCard } from "../../../components/PricingCard";
import { PricingToggle } from "../../../components/PricingToggle";

const pricingPlans = [
  {
    id: "free",
    name: "Free",
    price: "Free",
    description:
      "Try Teak with your most important inspiration. 25 cards go further than you think.",
    features: [
      "25 cards",
      "Instant search",
      "Works everywhere",
      "All core features",
      "No credit card",
    ],
    cta: {
      text: "Join Waitlist →",
      href: "https://accounts.teakvault.com/waitlist",
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
      "Unlimited inspiration for serious designers. Save everything, find anything.",
    features: [
      "Unlimited cards",
      "Instant search",
      "Works everywhere",
      "All core features",
      "Priority support",
    ],
    cta: {
      text: "Join Waitlist →",
      href: "https://accounts.teakvault.com/waitlist",
      primary: true,
    },
    popular: true,
  },
  {
    id: "selfhosted",
    name: "Self-Hosted",
    price: "Free",
    description:
      "Run Teak on your own server. Unlimited cards, complete control, zero cost.",
    features: [
      "Unlimited cards",
      "Full source code",
      "Your data stays yours",
      "Customize anything",
      "No monthly fees",
    ],
    cta: {
      text: "Setup Guide →",
      href: "/docs",
    },
  },
];

const faqs = [
  {
    question: "Why 25 cards on free?",
    answer:
      "25 cards cover your most important inspiration. When you need more, Pro gives you unlimited cards for the price of one coffee per week.",
  },
  {
    question: "Pro vs Self-hosted?",
    answer:
      "Pro: we handle everything, you just use it. Self-hosted: you run the server, keep everything free. Same features, different setup.",
  },
  {
    question: "Can I change plans anytime?",
    answer:
      "Yes. Switch monthly to yearly (save 35%), upgrade, downgrade, or export your data and leave. No lock-in.",
  },
  {
    question: "30-day refund?",
    answer:
      "Absolutely. Try Pro risk-free for 30 days. If you don't love it, get a full refund, no questions asked.",
  },
  {
    question: "Self-hosting really free?",
    answer:
      "100% free. MIT license means you can run Teak anywhere. Perfect for agencies who need complete data control.",
  },
  {
    question: "What if I hit 25 cards?",
    answer:
      "Your cards stay safe. You just can't add more until you upgrade to Pro or self-host. Never lose your inspiration.",
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
            Simple pricing for designers
          </h1>
          <p className="mx-auto max-w-2xl text-muted-foreground text-lg text-balance">
            Start free, upgrade when you're hooked. No tricks, no hidden fees.
          </p>
        </div>
      </section>

      {/* Pricing Toggle */}
      <div className="container mx-auto px-4 pb-4">
        <PricingToggle onToggle={setIsYearly} defaultYearly={false} />
      </div>

      {/* Pricing Cards */}
      <section className="pb-20 md:pb-24">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto">
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

      {/* Value Proposition */}
      <section className="bg-muted/20 py-20 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="mb-6 font-bold text-3xl text-balance">
              Pick your path
            </h2>
            <p className="mb-12 text-muted-foreground text-lg text-balance">
              Start with 25 cards free. Upgrade to Pro when you need more. Or
              self-host for total control.
            </p>
            <div className="grid gap-8 md:grid-cols-3">
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <Rocket className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold text-balance">Try It Free</h3>
                <p className="text-muted-foreground text-sm">
                  25 cards for your most important inspiration. See why
                  designers love Teak.
                </p>
              </div>
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <TrendingUp className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold text-balance">Go Pro</h3>
                <p className="text-muted-foreground text-sm">
                  Unlimited cards for serious designers. Less than one coffee
                  per week.
                </p>
              </div>
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <Wrench className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold text-balance">Self-Host</h3>
                <p className="text-muted-foreground text-sm">
                  Run it yourself. Unlimited cards, zero cost, complete control.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 font-bold text-3xl text-balance">
              Pricing questions
            </h2>
            <p className="mx-auto max-w-xl text-muted-foreground text-balance">
              Quick answers about our plans.
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
                <p className="text-muted-foreground text-sm">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
