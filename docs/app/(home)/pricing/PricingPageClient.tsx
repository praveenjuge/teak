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
      "25 cards go further than you think. Your most important inspiration, completely free.",
    features: [
      "25 cards",
      "Find anything in 2 seconds",
      "Works on phone, laptop, tablet",
      "All features, no limits",
      "No credit card, ever",
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
      "Unlimited inspiration for the price of 2 coffees/month. Save everything, find anything.",
    features: [
      "Unlimited cards",
      "Find anything in 2 seconds",
      "Works on phone, laptop, tablet",
      "All features, no limits",
      "Get help in 2 hours, not 2 days",
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
      "Run Teak yourself. Unlimited cards, total control, zero cost. Perfect for agencies.",
    features: [
      "Unlimited cards",
      "Full source code access",
      "Your data never leaves your server",
      "Customize anything you want",
      "Zero monthly fees, forever",
    ],
    cta: {
      text: "Setup Guide →",
      href: "/docs",
    },
  },
];

const faqs = [
  {
    question: "Why exactly 25 cards?",
    answer:
      "25 cards covers your most important inspiration. When you need more, Pro is just $19/month - less than 2 coffees.",
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
    question: "What happens when I hit 25 cards?",
    answer:
      "Your 25 cards stay safe forever. You just can't add more until you go Pro or self-host. We never delete your inspiration.",
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
            25 cards free. $19/month after.
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
              Choose your adventure
            </h2>
            <p className="mb-12 text-muted-foreground text-lg text-balance">
              Start free with 25 cards. Go Pro for unlimited. Or self-host for
              total control. Your call.
            </p>
            <div className="grid gap-8 md:grid-cols-3">
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <Rocket className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold text-balance">Try It Free</h3>
                <p className="text-muted-foreground text-sm">
                  25 cards for your most important inspiration. See why
                  designers are switching to Teak.
                </p>
              </div>
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <TrendingUp className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold text-balance">Go Pro</h3>
                <p className="text-muted-foreground text-sm">
                  Unlimited cards for serious designers. Less than 2 coffees per
                  month.
                </p>
              </div>
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <Wrench className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-2 font-semibold text-balance">Self-Host</h3>
                <p className="text-muted-foreground text-sm">
                  Run it yourself. Unlimited cards, zero cost, your data never
                  leaves your server.
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
              Still confused about pricing?
            </h2>
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
                <p className="text-muted-foreground text-sm">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
