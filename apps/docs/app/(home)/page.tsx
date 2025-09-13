import { Metadata } from "next";
import { FeatureCard } from "../../components/FeatureCard";
import { CTASection } from "../../components/CTASection";
import { Footer } from "../../components/Footer";
import { BackgroundPattern } from "../../components/BackgroundPattern";
import { Button } from "../../components/ui/button";
import Image from "next/image";
import {
  X,
  Check,
  FileText,
  Link,
  Camera,
  Video,
  Mic,
  File,
  Smartphone,
  FolderOpen,
  Search,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Teak - Never Lose Another Idea | Ultimate Productivity Hub",
  description:
    "Teak unifies your thoughts, links, and files in one searchable hub that syncs instantly across all devices. Join thousands boosting their productivity.",
  keywords:
    "productivity app, idea management, note taking, cross-device sync, knowledge management, creative productivity, focus tools, digital workspace, information organization",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "Teak - Never Lose Another Idea",
    description:
      "The productivity hub that captures everything important and helps you find it instantly. Stop juggling multiple apps - centralize your digital life.",
    type: "website",
    url: "https://teakvault.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "Teak - Never Lose Another Idea",
    description:
      "The productivity hub that captures everything important and helps you find it instantly.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const features = [
  {
    icon: "lightning" as const,
    title: "Real-Time Sync",
    description:
      "Instant updates across web, mobile, and browser extension with Convex real-time database.",
  },
  {
    icon: "mobile" as const,
    title: "Cross-Platform",
    description:
      "Web app, iOS/Android mobile apps, and Chrome extension - access your knowledge everywhere.",
  },
  {
    icon: "search" as const,
    title: "Smart Search",
    description:
      "Full-text search across all content types with smart tagging and filtering.",
  },
  {
    icon: "heart" as const,
    title: "Open Source",
    description:
      "MIT licensed, completely free, and built with modern technologies like Next.js 15 and Convex.",
  },
];

const howItWorksSteps = [
  {
    step: "1",
    title: "Capture Everything",
    description:
      "Save text, links, images, videos, audio, and documents from anywhere with one click.",
    icon: <Smartphone className="h-6 w-6" />,
  },
  {
    step: "2",
    title: "Auto-Organize",
    description:
      "Smart tagging and categorization keeps everything organized without manual effort.",
    icon: <FolderOpen className="h-6 w-6" />,
  },
  {
    step: "3",
    title: "Rediscover Instantly",
    description:
      "Powerful search and filters help you find exactly what you need, exactly when you need it.",
    icon: <Search className="h-6 w-6" />,
  },
];

const faqs = [
  {
    question: "Is Teak really free?",
    answer:
      "Yes! Teak is open source and MIT licensed. You can use it completely free or self-host your own instance. We believe great productivity tools shouldn't have paywalls.",
  },
  {
    question: "How is my data protected?",
    answer:
      "Your privacy is paramount. All data is encrypted in transit and at rest. Being open source means you can audit the code yourself, and self-hosting gives you complete control.",
  },
  {
    question: "What devices and platforms work?",
    answer:
      "Teak works everywhere: web app, iOS/Android mobile apps, and Chrome browser extension. Everything syncs instantly across all your devices.",
  },
  {
    question: "Can I import my existing notes?",
    answer:
      "Yes! We support importing from most popular note-taking apps. Your existing knowledge can seamlessly move to Teak without losing anything.",
  },
  {
    question: "How fast is the sync?",
    answer:
      "Instant. Built on Convex's real-time infrastructure, changes appear across all devices in milliseconds. No more refresh-and-pray.",
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col relative">
      {/* Background Pattern */}
      <div className="absolute top-0 left-0 w-full h-[600px] overflow-hidden pointer-events-none">
        <BackgroundPattern />
      </div>

      {/* Hero Section */}
      <section className="relative py-20 md:py-32">
        <div className="container mx-auto px-4">
          <div className="text-center mb-24">
            <h1 className="mb-4 font-bold text-4xl md:text-5xl text-balance">
              Save fast. Find faster.
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-muted-foreground text-lg text-balance">
              Teak is the single hub where all your important thoughts, links,
              and files live - searchable instantly, synced everywhere.
            </p>
            <div className="flex flex-col justify-center gap-4 sm:flex-row">
              <Button size="lg" asChild>
                <a
                  href="https://accounts.teakvault.com/waitlist"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Join Waitlist →
                </a>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <a
                  href="https://app.teakvault.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Login
                </a>
              </Button>
            </div>
          </div>

          {/* Hero Image */}
          <div className="mx-auto max-w-6xl">
            <div className="relative rounded-lg overflow-hidden">
              <Image
                src="/hero-image.png"
                alt="Teak app interface showing various saved content types"
                width={1200}
                height={800}
                className="w-full h-auto"
                priority
              />
            </div>
          </div>
        </div>
      </section>

      {/* Problem/Solution Section */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 className="mb-6 font-bold text-3xl md:text-4xl text-balance">
                Tired of losing your best ideas in a sea of scattered apps?
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    <strong>Brilliant ideas vanish</strong> because you saved
                    them in some random notes app you forgot about
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    <strong>Important links disappear</strong> into bookmark
                    folders you&apos;ll never check again
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    <strong>Files scatter everywhere</strong> - some in Drive,
                    some in Dropbox, some on your desktop
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    <strong>Searching takes forever</strong> because your
                    knowledge lives in 10+ different apps
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-8">
              <h3 className="mb-6 font-bold text-xl text-balance">
                Teak fixes this. One place, everything findable.
              </h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    <strong>Every idea captured</strong> with one-click saving
                    from any app or website
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    <strong>Everything searchable</strong> - find any content in
                    seconds, not minutes
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    <strong>Always synchronized</strong> - access from phone,
                    computer, or browser
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    <strong>Actually organized</strong> - smart tagging means
                    less manual work
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 md:py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl text-balance">
              Built for the way you think
            </h2>
            <p className="mx-auto max-w-xl text-muted-foreground text-balance">
              Capture, organize, and rediscover everything that matters to you.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {features.map((feature, index) => (
              <FeatureCard
                key={index}
                description={feature.description}
                icon={feature.icon}
                title={feature.title}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Content Types Preview */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-6 font-bold text-3xl md:text-4xl text-balance">
              Save everything that matters
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-muted-foreground text-lg text-balance">
              From quick thoughts to important documents, Teak handles every
              type of content you want to preserve and rediscover.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            <div className="group relative rounded-lg border bg-card p-6 transition-all duration-300 hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <FileText className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-lg text-balance">
                Text Notes
              </h3>
              <p className="text-muted-foreground text-sm">
                Quick thoughts, meeting notes, and detailed documentation all in
                one searchable place.
              </p>
            </div>

            <div className="group relative rounded-lg border bg-card p-6 transition-all duration-300 hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Link className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-lg text-balance">
                Bookmarks
              </h3>
              <p className="text-muted-foreground text-sm">
                Save articles, tools, and resources with automatic metadata
                extraction and organization.
              </p>
            </div>

            <div className="group relative rounded-lg border bg-card p-6 transition-all duration-300 hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Camera className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-lg text-balance">
                Images
              </h3>
              <p className="text-muted-foreground text-sm">
                Screenshots, photos, and visual references with automatic
                thumbnail generation.
              </p>
            </div>

            <div className="group relative rounded-lg border bg-card p-6 transition-all duration-300 hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Video className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-lg text-balance">
                Videos
              </h3>
              <p className="text-muted-foreground text-sm">
                Screen recordings, tutorials, and video content with preview
                thumbnails.
              </p>
            </div>

            <div className="group relative rounded-lg border bg-card p-6 transition-all duration-300 hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Mic className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-lg text-balance">Audio</h3>
              <p className="text-muted-foreground text-sm">
                Voice memos, recordings, and audio notes with waveform
                visualization.
              </p>
            </div>

            <div className="group relative rounded-lg border bg-card p-6 transition-all duration-300 hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <File className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-lg text-balance">
                Documents
              </h3>
              <p className="text-muted-foreground text-sm">
                PDFs, spreadsheets, and files with full-text search and preview
                capabilities.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 md:py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-6 font-bold text-3xl md:text-4xl text-balance">
              How it works
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-muted-foreground text-lg text-balance">
              Three simple steps to transform how you capture, organize, and
              rediscover your most important ideas.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto">
            {howItWorksSteps.map((step, index) => (
              <div
                key={index}
                className="group relative rounded-lg border bg-card p-8 transition-all duration-300 hover:-translate-y-1"
              >
                <div className="mb-6 flex items-center">
                  <div className="mr-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">
                    {step.step}
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                    {step.icon}
                  </div>
                </div>
                <h3 className="mb-3 font-semibold text-xl text-balance">
                  {step.title}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
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
              Everything you need to know about Teak.
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

      {/* Final CTA Section */}
      <CTASection
        title="Ready to get started?"
        description="Start organizing your ideas with Teak today."
        primaryCTA={{
          text: "Join Waitlist",
          href: "https://accounts.teakvault.com/waitlist",
        }}
        secondaryCTA={{
          text: "Login →",
          href: "https://app.teakvault.com",
        }}
      />

      {/* Footer */}
      <Footer />
    </main>
  );
}
