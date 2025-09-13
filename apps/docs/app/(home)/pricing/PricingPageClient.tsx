"use client";

import { useState } from "react";
import { Rocket, TrendingUp, Wrench } from "lucide-react";
import { PricingCard } from "../../../components/PricingCard";
import { PricingToggle } from "../../../components/PricingToggle";
import { CTASection } from "../../../components/CTASection";
import { Footer } from "../../../components/Footer";

const pricingPlans = [
  {
    id: "free",
    name: "Free",
    price: "Free",
    description:
      "Perfect for getting started with Teak and organizing your first ideas.",
    features: [
      "25 cards maximum",
      "Full-text search",
      "Cross-platform sync",
      "Web, mobile & browser extension",
      "All core features included",
      "Community support",
    ],
    cta: {
      text: "Get Started Free →",
      href: "https://app.teakvault.com",
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
      "Unlimited storage for all your ideas, thoughts, and inspiration.",
    features: [
      "Unlimited cards",
      "Full-text search",
      "Cross-platform sync",
      "Web, mobile & browser extension",
      "All core features included",
      "Priority support",
    ],
    cta: {
      text: "Get Started with Pro →",
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
      "Complete control with unlimited storage on your own infrastructure.",
    features: [
      "Unlimited cards",
      "Full source code access",
      "Complete data ownership",
      "Custom modifications allowed",
      "No vendor lock-in",
      "Community support",
    ],
    cta: {
      text: "View Setup Guide →",
      href: "/docs",
    },
  },
];

const faqs = [
  {
    question: "Why is there a 25-card limit on the free plan?",
    answer:
      "The 25-card limit helps us provide reliable free service while encouraging users who love Teak to upgrade to Pro for unlimited storage.",
  },
  {
    question: "What's the difference between Pro and Self-hosted?",
    answer:
      "Pro gives you unlimited cards on our managed cloud service. Self-hosted is free but requires you to run and maintain your own server infrastructure.",
  },
  {
    question: "Can I switch between monthly and yearly Pro plans?",
    answer:
      "Yes! You can switch anytime. Yearly subscribers save 35% compared to monthly pricing.",
  },
  {
    question: "Do you offer refunds?",
    answer:
      "Yes, we offer full refunds within 30 days, no questions asked. We're confident you'll love Teak.",
  },
  {
    question: "Is self-hosting really free?",
    answer:
      "Yes! Teak is open source (MIT license), so you can self-host for free. You'll need technical knowledge to set up and maintain your own server.",
  },
  {
    question: "What happens if I exceed 25 cards on the free plan?",
    answer:
      "You won't lose any data, but you'll need to upgrade to Pro or self-host to add more cards. All existing cards remain accessible.",
  },
];

export default function PricingPageClient() {
  const [isYearly, setIsYearly] = useState(false);

  return (
    <main className="flex flex-1 flex-col">
      {/* Hero Section */}
      <section className="pt-20 pb-10">
        <div className="container mx-auto px-4 text-center max-w-xl">
          <h1 className="mb-4 font-bold text-4xl text-balance">
            Start free. Upgrade for unlimited cards.
          </h1>
          <p className="mx-auto max-w-2xl text-muted-foreground text-lg text-balance">
            No hidden fees, no surprises.
          </p>
        </div>
      </section>

      {/* Pricing Toggle */}
      <section className="pb-8">
        <div className="container mx-auto px-4">
          <PricingToggle onToggle={setIsYearly} defaultYearly={false} />
        </div>
      </section>

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
              Start free, scale when ready
            </h2>
            <p className="mb-12 text-muted-foreground text-lg text-balance">
              Most users find 25 cards perfect for getting started. When you
              need more, Pro gives you unlimited storage.
            </p>
            <div className="grid gap-8 md:grid-cols-3">
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <Rocket className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold text-balance">
                  Start Free Today
                </h3>
                <p className="text-muted-foreground text-sm">
                  25 cards is plenty to organize your most important ideas and
                  see if Teak works for you.
                </p>
              </div>
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <TrendingUp className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold text-balance">
                  Upgrade When Ready
                </h3>
                <p className="text-muted-foreground text-sm">
                  When 25 cards isn&apos;t enough, Pro gives you unlimited
                  storage for all your ideas.
                </p>
              </div>
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <Wrench className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold text-balance">
                  Self-Host Option
                </h3>
                <p className="text-muted-foreground text-sm">
                  Technical users can self-host for free with unlimited cards
                  and complete control.
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
              Frequently asked questions
            </h2>
            <p className="mx-auto max-w-xl text-muted-foreground text-balance">
              Got questions? We&apos;ve got answers.
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
