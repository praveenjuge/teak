import Link from "next/link";
import { Metadata } from "next";
import { FeatureCard } from "../../components/FeatureCard";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Teak - Never Lose Another Idea | Ultimate Productivity Hub",
  description:
    "Stop losing brilliant ideas in scattered apps. Teak unifies your thoughts, links, and files in one searchable hub that syncs instantly across all devices. Join thousands boosting their productivity.",
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
    icon: "📱",
  },
  {
    step: "2",
    title: "Auto-Organize",
    description:
      "Smart tagging and categorization keeps everything organized without manual effort.",
    icon: "🗂️",
  },
  {
    step: "3",
    title: "Rediscover Instantly",
    description:
      "Powerful search and filters help you find exactly what you need, exactly when you need it.",
    icon: "🔍",
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
    <main className="flex flex-1 flex-col">
      {/* Hero Section */}
      <section className="py-20 md:py-32">
        <div className="container mx-auto px-4 text-center">
          <h1 className="mb-6 font-bold text-4xl md:text-5xl">
            Never Lose Another Brilliant Idea
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-fd-muted-foreground text-lg">
            Stop juggling multiple apps. Teak is the single hub where all your
            important thoughts, links, and files live - searchable instantly,
            synced everywhere.
          </p>
          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <a
              className="inline-flex items-center justify-center rounded-lg bg-fd-primary px-8 py-4 font-semibold text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
              href="https://accounts.teakvault.com/waitlist"
              target="_blank"
              rel="noopener noreferrer"
            >
              Join Waitlist
            </a>
            <a
              className="inline-flex items-center justify-center rounded-lg border border-fd-border px-8 py-4 font-medium text-fd-foreground transition-colors hover:bg-fd-muted"
              href="https://app.teakvault.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Login →
            </a>
          </div>
        </div>
      </section>

      {/* Problem/Solution Section */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 className="mb-6 font-bold text-3xl md:text-4xl">
                Tired of losing your best ideas in a sea of scattered apps?
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-red-500">❌</div>
                  <p className="text-fd-muted-foreground">
                    <strong>Brilliant ideas vanish</strong> because you saved
                    them in some random notes app you forgot about
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-red-500">❌</div>
                  <p className="text-fd-muted-foreground">
                    <strong>Important links disappear</strong> into bookmark
                    folders you&apos;ll never check again
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-red-500">❌</div>
                  <p className="text-fd-muted-foreground">
                    <strong>Files scatter everywhere</strong> - some in Drive,
                    some in Dropbox, some on your desktop
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-red-500">❌</div>
                  <p className="text-fd-muted-foreground">
                    <strong>Searching takes forever</strong> because your
                    knowledge lives in 10+ different apps
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-fd-border bg-fd-card p-8">
              <h3 className="mb-6 font-bold text-xl">
                Teak fixes this. One place, everything findable.
              </h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-fd-accent-foreground">✅</div>
                  <p className="text-fd-card-foreground">
                    <strong>Every idea captured</strong> with one-click saving
                    from any app or website
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-fd-accent-foreground">✅</div>
                  <p className="text-fd-card-foreground">
                    <strong>Everything searchable</strong> - find any content in
                    seconds, not minutes
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-fd-accent-foreground">✅</div>
                  <p className="text-fd-card-foreground">
                    <strong>Always synchronized</strong> - access from phone,
                    computer, or browser
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-fd-accent-foreground">✅</div>
                  <p className="text-fd-card-foreground">
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
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl">
              Built for the way you think
            </h2>
            <p className="mx-auto max-w-xl text-fd-muted-foreground">
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
      <section className="bg-fd-muted/20 py-20 md:py-24">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-4 font-bold text-3xl md:text-4xl">
            Save everything that matters
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-fd-muted-foreground text-lg">
            Text notes, bookmarks, images, videos, audio, and documents - all in
            one place.
          </p>

          <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg border border-fd-border bg-fd-card p-4">
              <div className="mb-2 text-2xl">📝</div>
              <div className="font-medium">Text</div>
            </div>
            <div className="rounded-lg border border-fd-border bg-fd-card p-4">
              <div className="mb-2 text-2xl">🔗</div>
              <div className="font-medium">Links</div>
            </div>
            <div className="rounded-lg border border-fd-border bg-fd-card p-4">
              <div className="mb-2 text-2xl">📷</div>
              <div className="font-medium">Images</div>
            </div>
            <div className="rounded-lg border border-fd-border bg-fd-card p-4">
              <div className="mb-2 text-2xl">🎥</div>
              <div className="font-medium">Videos</div>
            </div>
            <div className="rounded-lg border border-fd-border bg-fd-card p-4">
              <div className="mb-2 text-2xl">🎤</div>
              <div className="font-medium">Audio</div>
            </div>
            <div className="rounded-lg border border-fd-border bg-fd-card p-4">
              <div className="mb-2 text-2xl">📄</div>
              <div className="font-medium">Documents</div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl">How it works</h2>
            <p className="mx-auto max-w-xl text-fd-muted-foreground">
              Three simple steps to organize your ideas.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {howItWorksSteps.map((step, index) => (
              <div key={index} className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-fd-muted text-2xl">
                  {step.icon}
                </div>
                <h3 className="mb-2 font-semibold">{step.title}</h3>
                <p className="text-fd-muted-foreground text-sm">
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
            <h2 className="mb-4 font-bold text-3xl">
              Frequently asked questions
            </h2>
            <p className="mx-auto max-w-xl text-fd-muted-foreground">
              Everything you need to know about Teak.
            </p>
          </div>

          <div className="mx-auto max-w-2xl space-y-4">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className="rounded-lg border border-fd-border bg-fd-card p-6"
              >
                <h3 className="mb-3 font-semibold text-fd-foreground">
                  {faq.question}
                </h3>
                <p className="text-fd-muted-foreground text-sm">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="border-fd-border border-t bg-fd-muted/20 py-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-4 font-bold text-3xl">Ready to get started?</h2>
          <p className="mx-auto mb-8 max-w-xl text-fd-muted-foreground">
            Start organizing your ideas with Teak today.
          </p>
          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <a
              className="inline-flex items-center justify-center rounded-lg bg-fd-primary px-8 py-4 font-semibold text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
              href="https://accounts.teakvault.com/waitlist"
              target="_blank"
              rel="noopener noreferrer"
            >
              Join Waitlist
            </a>
            <a
              className="inline-flex items-center justify-center rounded-lg border border-fd-border px-8 py-4 font-medium text-fd-foreground transition-colors hover:bg-fd-muted"
              href="https://app.teakvault.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Login →
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-fd-border border-t py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <Logo />
            <div className="flex gap-6 text-fd-muted-foreground text-sm">
              <Link href="/docs" className="hover:text-fd-foreground">
                Documentation
              </Link>
              <a
                href="https://github.com/praveenjuge/teak"
                className="hover:text-fd-foreground"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              <a
                href="https://app.teakvault.com"
                className="hover:text-fd-foreground"
                target="_blank"
                rel="noopener noreferrer"
              >
                Login
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
