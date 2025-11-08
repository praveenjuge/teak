import { Metadata } from "next";
import { FeatureCard } from "../../components/FeatureCard";
import { Button } from "../../components/ui/button";
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
  title: "Never Lose Design Inspiration Again | Teak",
  description:
    "Bookmark, organize, and find any design inspiration in seconds. The visual bookmarking tool designers actually use.",
  keywords:
    "design bookmarking, visual inspiration, design organization, creative workflow, designer tools, bookmark manager",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "Never Lose Design Inspiration Again",
    description:
      "Bookmark, organize, and find any design inspiration in seconds. The visual bookmarking tool designers actually use.",
    type: "website",
    url: "https://teakvault.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "Never Lose Design Inspiration Again",
    description:
      "Bookmark, organize, and find any design inspiration in seconds. The visual bookmarking tool designers actually use.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const features = [
  {
    icon: "lightning" as const,
    title: "Find Anything in Seconds",
    description:
      "Search your entire inspiration library instantly. No more digging through folders or scrolling endlessly.",
  },
  {
    icon: "mobile" as const,
    title: "Works Everywhere",
    description:
      "Web app, mobile apps, browser extension. Capture inspiration wherever you find it.",
  },
  {
    icon: "search" as const,
    title: "Visual Organization",
    description:
      "Smart tagging and visual grids. Your inspiration organizes itself automatically.",
  },
  {
    icon: "heart" as const,
    title: "Free to Start",
    description:
      "25 cards free, then upgrade when you're hooked. No credit card required.",
  },
];

const howItWorksSteps = [
  {
    step: "1",
    title: "Save Anything",
    description:
      "One-click bookmarking from any website. Images, links, notes, files - everything in one place.",
    icon: <Smartphone className="h-6 w-6" />,
  },
  {
    step: "2",
    title: "Auto-Organized",
    description:
      "Smart tagging and visual layouts. Your inspiration stays organized without any work.",
    icon: <FolderOpen className="h-6 w-6" />,
  },
  {
    step: "3",
    title: "Find Instantly",
    description:
      "Search everything visually. Find that perfect button style or color palette in seconds.",
    icon: <Search className="h-6 w-6" />,
  },
];

const faqs = [
  {
    question: "What can I save to Teak?",
    answer:
      "Everything: images, links, text notes, videos, voice memos, files. If you can find it online, you can save it.",
  },
  {
    question: "Is my data secure?",
    answer:
      "Yes. Encrypted in transit and at rest. Open source so you can verify the code. Self-hosting available for complete control.",
  },
  {
    question: "Does it work on mobile?",
    answer:
      "Yes. Native iOS/Android apps plus web app and Chrome extension. Your inspiration syncs everywhere instantly.",
  },
  {
    question: "How is this different from Pinterest?",
    answer:
      "Teak is private bookmarking for your professional work. No social features, no algorithms - just your inspiration, perfectly organized.",
  },
  {
    question: "What if I need more than 25 cards?",
    answer:
      "Upgrade to Pro for unlimited cards ($19/month) or self-host for free. All your existing cards stay with you.",
  },
  {
    question: "Can I export my data?",
    answer:
      "Yes. You own your data. Export anytime in standard formats. No vendor lock-in.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero Section */}
      <section className="relative pt-14 md:pt-22">
        <div className="container mx-auto px-4">
          <div className="text-center mb-18 mx-auto max-w-2xl">
            <h1 className="mb-4 font-bold text-4xl md:text-5xl text-balance tracking-tight">
              Never lose design inspiration again
            </h1>
            <p className="mx-auto mb-6 max-w-xl text-muted-foreground text-lg text-balance">
              Save anything, find everything. The visual bookmarking tool
              designers actually use every day.
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
          <div className="mx-auto max-w-5xl">
            <div className="relative rounded-lg overflow-hidden">
              <img
                src="/hero-image.png"
                alt="Teak app interface showing various saved content types"
                width={1200}
                height={800}
                className="w-full h-auto"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Problem/Solution Section */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 className="mb-6 font-bold text-3xl md:text-4xl text-balance">
                Your inspiration is scattered everywhere
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    <strong>Browser bookmarks you never check</strong>
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    <strong>Pinterest boards with algorithm noise</strong>
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    <strong>Screenshots buried in folders</strong>
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    <strong>Hours wasted finding that one thing</strong>
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-8">
              <h3 className="mb-6 font-bold text-xl text-balance">
                Teak puts everything in one place
              </h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    <strong>Save anything with one click</strong>
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    <strong>Find everything in seconds</strong>
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    <strong>Works on all your devices</strong>
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    <strong>Auto-organizes itself</strong>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 md:py-24 bg-background">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl text-balance">
              Why designers choose Teak
            </h2>
            <p className="mx-auto max-w-xl text-muted-foreground text-balance">
              Finally, a bookmarking tool that works the way you do.
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
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="mb-16 text-center">
            <h2 className="mb-6 font-bold text-3xl md:text-4xl text-balance">
              Save everything you find
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-muted-foreground text-lg text-balance">
              Images, links, notes, videos, files. If you can find it, you can
              save it.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            <div className="group relative rounded-lg border bg-card p-6 transition-all duration-300 hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <FileText className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-lg text-balance">
                Design Notes
              </h3>
              <p className="text-muted-foreground text-sm">
                Design decisions, feedback notes, and project documentation
                organized and searchable.
              </p>
            </div>

            <div className="group relative rounded-lg border bg-card p-6 transition-all duration-300 hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Link className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-lg text-balance">
                Design Resources
              </h3>
              <p className="text-muted-foreground text-sm">
                Save design inspiration, tools, libraries, and tutorials with
                automatic previews and metadata.
              </p>
            </div>

            <div className="group relative rounded-lg border bg-card p-6 transition-all duration-300 hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Camera className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-lg text-balance">
                Visual References
              </h3>
              <p className="text-muted-foreground text-sm">
                Screenshots, mockups, mood boards, and design inspiration with
                smart visual organization.
              </p>
            </div>

            <div className="group relative rounded-lg border bg-card p-6 transition-all duration-300 hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Video className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-lg text-balance">
                Design Videos
              </h3>
              <p className="text-muted-foreground text-sm">
                Animation references, design tutorials, and process videos with
                instant previews.
              </p>
            </div>

            <div className="group relative rounded-lg border bg-card p-6 transition-all duration-300 hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Mic className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-lg text-balance">
                Audio Notes
              </h3>
              <p className="text-muted-foreground text-sm">
                Voice memos for design ideas, client feedback, and quick notes
                with waveform preview.
              </p>
            </div>

            <div className="group relative rounded-lg border bg-card p-6 transition-all duration-300 hover:-translate-y-1">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <File className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold text-lg text-balance">
                Design Files
              </h3>
              <p className="text-muted-foreground text-sm">
                Design systems, brand guidelines, and project files with
                full-text search and previews.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 md:py-24 bg-background">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="mb-16 text-center">
            <h2 className="mb-6 font-bold text-3xl md:text-4xl text-balance">
              Start organizing in 3 steps
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-muted-foreground text-lg text-balance">
              No learning curve. Just save, organize, find.
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
        <div className="max-w-5xl mx-auto px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 font-bold text-3xl text-balance">Questions?</h2>
            <p className="mx-auto max-w-xl text-muted-foreground text-balance">
              Quick answers about Teak.
            </p>
          </div>

          <div className="gap-6 grid grid-cols-1 md:grid-cols-2">
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
    </>
  );
}
