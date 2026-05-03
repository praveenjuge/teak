export const pricingPlans = [
  {
    id: "free",
    name: "Free",
    emojiAlt: "Gift box emoji",
    emojiSrc: "/emojis/pricing-free-gift-box.webp",
    price: "Free" as const,
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
    emojiAlt: "Crown emoji",
    emojiSrc: "/emojis/pricing-pro-crown.webp",
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
] as const;

export const selfHostedPlan = {
  name: "Self-Hosted",
  emojiAlt: "Server rack emoji",
  emojiSrc: "/emojis/pricing-self-hosted-server-rack.webp",
  description: "Run Teak yourself. Unlimited cards, total control, zero cost.",
  cta: {
    text: "Setup Guide →",
    href: "/docs",
  },
} as const;

export const pricingFaqs = [
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
      "Yep. Monthly to yearly (save 35%), upgrade, downgrade, or leave entirely. Export your data with one click. We don\u2019t do lock-in.",
  },
  {
    question: "What if I hate it?",
    answer:
      "30-day full refund. No questions, no hassle. Try Pro for a month, if you don\u2019t love it, we\u2019ll give you every penny back.",
  },
  {
    question: "Self-hosting is actually free?",
    answer:
      "100% free. MIT license, run it anywhere. Perfect for agencies who want their data to never touch our servers.",
  },
  {
    question: "What happens when I hit 200 cards?",
    answer:
      "Your 200 cards stay safe forever. You just can\u2019t add more until you go Pro or self-host. We never delete your inspiration.",
  },
] as const;
