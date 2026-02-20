import { Button } from "@teak/ui/components/ui/button";
import { Check, X } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { FeatureCard } from "../../components/FeatureCard";
import {
  JsonLd,
  organizationSchema,
  SITE_URL,
  websiteSchema,
} from "../../components/JsonLd";

export const metadata: Metadata = {
  title: "Never Lose That Perfect Design Again",
  description:
    "Save inspiration in 1 click, find it in 2 seconds. Never lose your best ideas again.",
  keywords:
    "design bookmarking, visual inspiration, design organization, creative workflow, designer tools, bookmark manager",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "Never Lose That Perfect Design Again",
    description:
      "Save inspiration in 1 click, find it in 2 seconds. Never lose your best ideas again.",
    type: "website",
    url: "https://teakvault.com",
    siteName: "Teak",
    locale: "en_US",
    images: [
      {
        url: "/hero-image.png",
        width: 1200,
        height: 630,
        alt: "Teak - Never Lose That Perfect Design Again",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Never Lose That Perfect Design Again",
    description:
      "Save inspiration in 1 click, find it in 2 seconds. Never lose your best ideas again.",
    images: ["/hero-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "https://teakvault.com",
  },
};

// Thiings source catalog: https://www.thiings.co/things
// Pinned source URLs for these emojis are documented in task plan and mapped to /public/emojis/home-*.webp files below.
const features = [
  {
    emojiAlt: "Target face emoji",
    emojiSrc: "/emojis/home-why-target-face.webp",
    title: "Find That Perfect Button in 2 Seconds",
    description:
      "Type 'blue button' and find it instantly. No more digging through 27 folders to find that one thing.",
  },
  {
    emojiAlt: "Smartphone emoji",
    emojiSrc: "/emojis/home-why-smartphone.webp",
    title: "Your Inspiration Follows You",
    description:
      "Web, iPhone, Android, Chrome. Save on your phone, find it on your laptop. It just works.",
  },
  {
    emojiAlt: "Pressed leaf bookmark emoji",
    emojiSrc: "/emojis/home-why-bookmark.webp",
    title: "It Organizes Itself. Seriously.",
    description:
      "Smart tags and visual grids. You just save, Teak handles the rest. No manual sorting required.",
  },
  {
    emojiAlt: "Heart emoji",
    emojiSrc: "/emojis/home-why-heart.webp",
    title: "200 Cards Free (Enough for 6 Months)",
    description:
      "Try it with your most important inspiration. Upgrade when you need more. No credit card, no tricks.",
  },
];

const saveContentTypes = [
  {
    title: "Design Notes",
    description:
      "Client feedback, design decisions, that brilliant idea you had in the shower. All searchable.",
    emojiAlt: "Sticky note emoji",
    emojiSrc: "/emojis/home-save-sticky-note.webp",
  },
  {
    title: "Design Resources",
    description:
      "That color palette generator, the icon library you'll need next month, the tutorial you'll reference tomorrow.",
    emojiAlt: "Retro web browser interface emoji",
    emojiSrc: "/emojis/home-save-browser.webp",
  },
  {
    title: "Visual References",
    description:
      "Screenshots, mockups, that perfect landing page you saw. Teak remembers why you saved it.",
    emojiAlt: "Underwater camera emoji",
    emojiSrc: "/emojis/home-save-camera.webp",
  },
  {
    title: "Design Videos",
    description:
      "That Figma tutorial, the animation reference you'll need next week, the design process video that inspired you.",
    emojiAlt: "Film reel emoji",
    emojiSrc: "/emojis/home-save-film-reel.webp",
  },
  {
    title: "Audio Notes",
    description:
      "Client feedback calls, that idea you recorded while driving, quick voice memos. All transcribed and searchable.",
    emojiAlt: "Retro microphone emoji",
    emojiSrc: "/emojis/home-save-microphone.webp",
  },
  {
    title: "Design Files",
    description:
      "Brand guidelines, design systems, project files. Everything searchable with instant previews.",
    emojiAlt: "File folder emoji",
    emojiSrc: "/emojis/home-save-folder.webp",
  },
];

const howItWorksSteps = [
  {
    title: "Save in 1 Click",
    description:
      "See something you like? Click the extension. That's it. Images, links, notes - all saved forever.",
    emojiAlt: "Mobile phone emoji",
    emojiSrc: "/emojis/home-steps-mobile-phone.webp",
  },
  {
    title: "It Organizes Itself",
    description:
      "Teak tags everything automatically. No folders, no manual work.",
    emojiAlt: "Drawer organizer emoji",
    emojiSrc: "/emojis/home-steps-drawer-organizer.webp",
  },
  {
    title: "Find in 2 Seconds",
    description:
      "Type what you remember. 'Blue gradient button' or 'that Dribbble shot from last month'. Found it.",
    emojiAlt: "Target emoji",
    emojiSrc: "/emojis/home-steps-target.webp",
  },
  {
    title: "Ship Better Work",
    description:
      "Reach the finish line faster with every project because your references, notes, and decisions stay in one place.",
    emojiAlt: "Finish line emoji",
    emojiSrc: "/emojis/home-steps-finish-line.webp",
  },
];

const faqs = [
  {
    question: "What exactly can I save?",
    answer:
      "Literally anything. Screenshots, Dribbble shots, CodePen links, voice notes, PDFs, videos. If you can see it, you can save it.",
  },
  {
    question: "Is my stuff actually private?",
    answer:
      "100% private. Encrypted everywhere. We're open source so you can check the code. Or self-host for total control.",
  },
  {
    question: "Will this work on my phone?",
    answer:
      "Yep. iPhone app, Android app, web app, Chrome extension, and Raycast. Save on your commute, find it at your desk.",
  },
  {
    question: "How is this not just Pinterest?",
    answer:
      "Pinterest is for browsing and getting distracted. Teak is for working. No algorithms, no social pressure, just your personal library.",
  },
  {
    question: "What happens when I hit 200 cards?",
    answer:
      "Your cards stay safe forever. You just can't add more until you go Pro ($19/month) or self-host (free). We never delete your stuff, not even when you hit 200.",
  },
  {
    question: "Can I leave if I don't like it?",
    answer:
      "Absolutely. Export everything with one click. No lock-in, no tricks. Your data is yours, always.",
  },
];

// Generate FAQPage schema from FAQs
const faqPageSchema = {
  "@context": "https://schema.org" as const,
  "@type": "FAQPage" as const,
  mainEntity: faqs.map((faq) => ({
    "@type": "Question" as const,
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer" as const,
      text: faq.answer,
    },
  })),
};

export default function HomePage() {
  return (
    <>
      <JsonLd
        schema={[
          organizationSchema,
          websiteSchema,
          faqPageSchema,
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "@id": `${SITE_URL}/#webpage`,
            url: SITE_URL,
            name: "Never Lose That Perfect Design Again | Teak",
            description:
              "Save inspiration in 1 click, find it in 2 seconds. Never lose your best ideas again.",
            isPartOf: { "@id": `${SITE_URL}/#website` },
            about: { "@id": `${SITE_URL}/#organization` },
            primaryImageOfPage: {
              "@type": "ImageObject",
              url: `${SITE_URL}/hero-image.png`,
            },
          },
        ]}
      />
      {/* Hero Section */}
      <section className="relative pt-14 md:pt-22">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-18 max-w-2xl text-center">
            <h1 className="mb-4 text-balance font-bold text-4xl tracking-tight md:text-5xl">
              Never lose that perfect design again
            </h1>
            <p className="mx-auto mb-6 max-w-xl text-balance text-lg text-muted-foreground">
              Save inspiration in 1 click, find it in 2 seconds. Never lose your
              best ideas again.
            </p>
            <Button asChild size="lg">
              <a
                href="https://app.teakvault.com/register"
                rel="noopener noreferrer"
                target="_blank"
              >
                Start Free
              </a>
            </Button>
          </div>

          {/* Hero Image */}
          <div className="mx-auto max-w-5xl">
            <div className="relative overflow-hidden rounded-lg">
              <Image
                alt="Teak app interface showing various saved content types"
                className="h-auto w-full"
                height={800}
                src="/hero-image.png"
                unoptimized
                width={1200}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Problem/Solution Section */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto max-w-5xl px-4">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 className="mb-6 text-balance font-bold text-3xl md:text-4xl">
                You&apos;re wasting hours looking for that one thing
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    47 browser bookmarks you&apos;ll never check again
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    Pinterest showing you wedding dresses instead of UI
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    23 screenshots named &apos;Screen Shot 2024-...&apos;
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    That perfect button style you can&apos;t find anymore
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-8">
              <h3 className="mb-6 text-balance font-bold text-xl">
                Teak fixes this. Forever.
              </h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    Save anything in exactly 1 click
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    Find that exact shade of blue in 2 seconds
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    It works on your phone, laptop, and tablet
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    It organizes itself. You just create.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-background py-20 md:py-24">
        <div className="container mx-auto max-w-5xl px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-balance font-bold text-3xl">
              Why designers are switching to Teak
            </h2>
            <p className="mx-auto max-w-xl text-balance text-lg text-muted-foreground">
              Finally, a bookmarking tool that doesn&apos;t suck.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {features.map((feature) => (
              <FeatureCard
                description={feature.description}
                emojiAlt={feature.emojiAlt}
                emojiSrc={feature.emojiSrc}
                key={feature.title}
                title={feature.title}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Content Types Preview */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto max-w-5xl px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-6 text-balance font-bold text-3xl md:text-4xl">
              Save everything. Find anything.
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-balance text-lg text-muted-foreground">
              That perfect Dribbble shot, that CodePen you&apos;ll need later,
              that voice note about the client&apos;s feedback. Save it all.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {saveContentTypes.map((contentType) => (
              <FeatureCard
                description={contentType.description}
                emojiAlt={contentType.emojiAlt}
                emojiSrc={contentType.emojiSrc}
                key={contentType.title}
                title={contentType.title}
              />
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="bg-background py-20 md:py-24">
        <div className="container mx-auto max-w-5xl px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-6 text-balance font-bold text-3xl md:text-4xl">
              Master your inspiration in 3 minutes
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-balance text-lg text-muted-foreground">
              No tutorial needed. Just save, find, create.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {howItWorksSteps.map((step) => (
              <FeatureCard
                description={step.description}
                emojiAlt={step.emojiAlt}
                emojiSrc={step.emojiSrc}
                key={step.title}
                title={step.title}
              />
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 md:py-24">
        <div className="mx-auto max-w-4xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-balance font-bold text-3xl">
              Still have questions?
            </h2>
            <p className="mx-auto max-w-xl text-balance text-lg text-muted-foreground">
              We&apos;ve got answers. No corporate speak, promise.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {faqs.map((faq) => (
              <div
                className="rounded-lg border border-border bg-card p-6"
                key={faq.question}
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
    </>
  );
}
