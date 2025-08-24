import Link from "next/link";
import { FeatureCard } from "../../components/FeatureCard";

const features = [
  {
    icon: "lightning" as const,
    title: "Real-Time Sync",
    description: "Instant updates across web, mobile, and browser extension with Convex real-time database.",
  },
  {
    icon: "mobile" as const,
    title: "Cross-Platform",
    description: "Web app, iOS/Android mobile apps, and Chrome extension - access your knowledge everywhere.",
  },
  {
    icon: "search" as const,
    title: "Smart Search",
    description: "Full-text search across all content types with smart tagging and filtering.",
  },
  {
    icon: "heart" as const,
    title: "Open Source",
    description: "MIT licensed, completely free, and built with modern technologies like Next.js 15 and Convex.",
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero Section */}
      <section className="bg-gradient-to-b from-fd-background to-fd-muted/20 py-20 md:py-32">
        <div className="container mx-auto px-4 text-center">
          <h1 className="mb-6 bg-gradient-to-r from-fd-primary to-fd-primary/70 bg-clip-text font-bold text-5xl text-transparent md:text-7xl">
            Your Personal Knowledge Hub
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-fd-muted-foreground text-lg md:text-xl">
            Capture, organize, and rediscover your ideas across all your devices. 
            Built with modern web technologies for creative minds who think fast.
          </p>
          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <Link
              className="inline-flex items-center justify-center rounded-lg bg-fd-primary px-8 py-4 font-semibold text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
              href="/docs"
            >
              Get Started
            </Link>
            <a
              className="inline-flex items-center justify-center rounded-lg border border-fd-border px-8 py-4 font-medium text-fd-foreground transition-colors hover:bg-fd-muted"
              href="https://github.com/praveenjuge/teak"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl md:text-4xl">
              Built for the way you think
            </h2>
            <p className="mx-auto max-w-xl text-fd-muted-foreground text-lg">
              Six content types, real-time sync, and intelligent search across all your platforms.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, index) => (
              <FeatureCard
                description={feature.description}
                icon={feature.icon}
                key={index}
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
            Text notes, bookmarks, images, videos, audio, and documents - all in one place.
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

      {/* Getting Started */}
      <section className="py-20 md:py-24">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-8 font-bold text-3xl md:text-4xl">
            Ready to get started?
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-fd-muted-foreground text-lg">
            Clone the repository, run a few commands, and you&apos;ll have your own knowledge hub running in minutes.
          </p>
          <Link
            className="inline-flex items-center justify-center rounded-lg bg-fd-primary px-8 py-4 font-semibold text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
            href="/docs"
          >
            View Documentation
          </Link>
        </div>
      </section>
    </main>
  );
}
