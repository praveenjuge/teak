import { Metadata } from "next";
import { FeatureCard } from "../../components/FeatureCard";
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
  title: "The Bookmarking Tool Made for Designers | Teak",
  description:
    "Teak helps designers and developers bookmark, organize, and manage design inspiration—so creative ideas are always at your fingertips.",
  keywords:
    "visual bookmarking, design inspiration management, design bookmarks, visual inspiration, design system, pattern library, developer resources, design workflow, creative bookmarking",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "The Bookmarking Tool Made for Designers",
    description:
      "Bookmark, organize, and manage design inspiration with Teak. Perfect for designers and developers who need visual bookmarking at their fingertips.",
    type: "website",
    url: "https://teakvault.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "The Bookmarking Tool Made for Designers",
    description:
      "Bookmark, organize, and manage design inspiration with Teak. Perfect for designers and developers.",
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
      "Instantly sync bookmarked inspiration across all devices. Bookmark on desktop, access on mobile, reference anywhere.",
  },
  {
    icon: "mobile" as const,
    title: "Cross-Platform",
    description:
      "Web app, mobile apps, and browser extension - bookmark inspiration whether you're browsing, designing, or on the go.",
  },
  {
    icon: "search" as const,
    title: "Visual Search",
    description:
      "Find bookmarked inspiration instantly with smart search across images, links, and content with visual previews.",
  },
  {
    icon: "heart" as const,
    title: "Open Source",
    description:
      "MIT licensed and free for designers and developers. Built with modern tech stack for reliability.",
  },
];

const howItWorksSteps = [
  {
    step: "1",
    title: "Collect Inspiration",
    description:
      "Bookmark design inspiration, code snippets, and visual ideas from anywhere with one click.",
    icon: <Smartphone className="h-6 w-6" />,
  },
  {
    step: "2",
    title: "Visual Organization",
    description:
      "Smart tagging and visual grids automatically organize your bookmarked inspiration by project, style, or type.",
    icon: <FolderOpen className="h-6 w-6" />,
  },
  {
    step: "3",
    title: "Find & Reference",
    description:
      "Instantly search and filter to find the perfect bookmarked inspiration when designing or developing.",
    icon: <Search className="h-6 w-6" />,
  },
];

const faqs = [
  {
    question: "What types of content can I save as cards?",
    answer:
      "Six card types: text notes for design decisions, links with auto-metadata, images with drag-and-drop, videos with built-in player, voice memos, and document files like PDFs.",
  },
  {
    question: "How is my design work protected?",
    answer:
      "Your creative work is secure. All data is encrypted in transit and at rest. Being open source means you can audit the code, and self-hosting gives complete control over client work.",
  },
  {
    question: "What devices work for capturing inspiration?",
    answer:
      "Capture inspiration everywhere: web dashboard, iOS/Android mobile apps, and Chrome browser extension. Everything syncs instantly with real-time updates.",
  },
  {
    question: "Can I organize cards with tags and favorites?",
    answer:
      "Yes! Smart tagging automatically organizes your cards, plus you can manually tag and favorite important items. Visual masonry grid layout makes browsing effortless.",
  },
  {
    question: "What happens if I accidentally delete something?",
    answer:
      "Cards use soft deletion - they're marked as deleted but recoverable for 30 days. You can restore accidentally deleted cards or permanently remove them from trash.",
  },
  {
    question: "How does visual search work?",
    answer:
      "Find bookmarked inspiration instantly by searching text, tags, or visual content. Perfect for finding 'that button style' or 'that color palette' from months ago.",
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
              Bookmarking tool made for designers
            </h1>
            <p className="mx-auto mb-6 max-w-xl text-muted-foreground text-lg text-balance">
              Teak helps designers and developers bookmark, organize, and manage
              design inspiration—so creative ideas are always at your
              fingertips.
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
                Tired of losing design inspiration in scattered bookmarks and
                folders?
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    <strong>Perfect design inspiration disappears</strong> into
                    random bookmark folders you&apos;ll never check again
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    <strong>Visual inspiration gets lost</strong> across
                    Pinterest boards, browser tabs, and scattered screenshots
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    <strong>Design assets fragment</strong> across Figma, Sketch
                    files, local folders, and cloud storage
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    <strong>
                      Finding that perfect inspiration takes forever
                    </strong>{" "}
                    when it&apos;s buried across multiple design tools and apps
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-8">
              <h3 className="mb-6 font-bold text-xl text-balance">
                Teak fixes this. One visual bookmarking hub for all your design
                inspiration.
              </h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    <strong>Every design inspiration bookmarked</strong> with
                    one-click saving from any website or design tool
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    <strong>Everything visually searchable</strong> - find that
                    perfect inspiration in seconds, not hours
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    <strong>Always synchronized</strong> - access your
                    bookmarked inspiration from any device, anywhere
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-primary">
                    <Check className="h-4 w-4" />
                  </div>
                  <p className="text-card-foreground">
                    <strong>Visually organized</strong> - smart tagging and
                    visual grids make finding bookmarked inspiration effortless
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
              Built for visual bookmarking
            </h2>
            <p className="mx-auto max-w-xl text-muted-foreground text-balance">
              Bookmark, organize, and rediscover design inspiration exactly when
              you need it.
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
              Capture every type of design card
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-muted-foreground text-lg text-balance">
              From visual inspiration to code snippets, Teak handles every type
              of card designers and developers need.
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
              How it works
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-muted-foreground text-lg text-balance">
              Three simple steps to transform how you collect, organize, and use
              design inspiration.
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
            <h2 className="mb-4 font-bold text-3xl text-balance">
              Frequently asked questions
            </h2>
            <p className="mx-auto max-w-xl text-muted-foreground text-balance">
              Everything designers and developers need to know about Teak.
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
