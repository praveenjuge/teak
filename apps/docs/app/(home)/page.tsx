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
  title: "Never Lose That Perfect Design Again | Teak",
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
  },
  twitter: {
    card: "summary_large_image",
    title: "Never Lose That Perfect Design Again",
    description:
      "Save inspiration in 1 click, find it in 2 seconds. Never lose your best ideas again.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const features = [
  {
    icon: "lightning" as const,
    title: "Find That Perfect Button in 2 Seconds",
    description:
      "Type 'blue button' and find it instantly. No more digging through 27 folders to find that one thing.",
  },
  {
    icon: "mobile" as const,
    title: "Your Inspiration Follows You",
    description:
      "Web, iPhone, Android, Chrome. Save on your phone, find it on your laptop. It just works.",
  },
  {
    icon: "search" as const,
    title: "It Organizes Itself. Seriously.",
    description:
      "Smart tags and visual grids. You just save, Teak handles the rest. No manual sorting required.",
  },
  {
    icon: "heart" as const,
    title: "25 Cards Free (Enough for 3 Months)",
    description:
      "Try it with your most important inspiration. Upgrade when you need more. No credit card, no tricks.",
  },
];

const howItWorksSteps = [
  {
    step: "1",
    title: "Save in 1 Click",
    description:
      "See something you like? Click the extension. That's it. Images, links, notes - all saved forever.",
    icon: <Smartphone className="h-6 w-6" />,
  },
  {
    step: "2",
    title: "It Organizes Itself",
    description:
      "Teak tags everything automatically. No folders, no manual work. Your inspiration just stays organized.",
    icon: <FolderOpen className="h-6 w-6" />,
  },
  {
    step: "3",
    title: "Find in 2 Seconds",
    description:
      "Type what you remember. 'Blue gradient button' or 'that Dribbble shot from last month'. Found it.",
    icon: <Search className="h-6 w-6" />,
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
      "Yep. iPhone app, Android app, web app, Chrome extension. Save on your commute, find it at your desk.",
  },
  {
    question: "How is this not just Pinterest?",
    answer:
      "Pinterest is for browsing and getting distracted. Teak is for working. No algorithms, no social pressure, just your personal library.",
  },
  {
    question: "What happens when I hit 25 cards?",
    answer:
      "Your cards stay safe forever. You just can't add more until you go Pro ($19/month) or self-host (free). We never delete your stuff.",
  },
  {
    question: "Can I leave if I don't like it?",
    answer:
      "Absolutely. Export everything with one click. No lock-in, no tricks. Your data is yours, always.",
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
              Never lose that perfect design again
            </h1>
            <p className="mx-auto mb-6 max-w-xl text-muted-foreground text-lg text-balance">
              Save inspiration in 1 click, find it in 2 seconds. Never lose your
              best ideas again.
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
                You're wasting hours looking for that one thing
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    47 browser bookmarks you'll never check again
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
                    23 screenshots named 'Screen Shot 2024-...'
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 text-destructive">
                    <X className="h-4 w-4" />
                  </div>
                  <p className="text-muted-foreground">
                    That perfect button style you can't find anymore
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-8">
              <h3 className="mb-6 font-bold text-xl text-balance">
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
      <section className="py-20 md:py-24 bg-background">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl text-balance">
              Why designers are switching to Teak
            </h2>
            <p className="mx-auto max-w-xl text-muted-foreground text-balance">
              Finally, a bookmarking tool that doesn't suck.
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
              Save everything. Find anything.
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-muted-foreground text-lg text-balance">
              That perfect Dribbble shot, that CodePen you'll need later, that
              voice note about the client's feedback. Save it all.
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
                Client feedback, design decisions, that brilliant idea you had
                in the shower. All searchable.
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
                That color palette generator, the icon library you'll need next
                month, the tutorial you'll reference tomorrow.
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
                Screenshots, mockups, that perfect landing page you saw. Teak
                remembers why you saved it.
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
                That Figma tutorial, the animation reference you'll need next
                week, the design process video that inspired you.
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
                Client feedback calls, that idea you recorded while driving,
                quick voice memos. All transcribed and searchable.
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
                Brand guidelines, design systems, project files. Everything
                searchable with instant previews.
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
              Master your inspiration in 3 minutes
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-muted-foreground text-lg text-balance">
              No tutorial needed. Just save, find, create.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto">
            {howItWorksSteps.map((step, index) => (
              <div
                key={index}
                className="group relative rounded-lg border bg-card p-8 transition-all duration-300 hover:-translate-y-1"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 mb-4 text-primary">
                  {step.icon}
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
              Still have questions?
            </h2>
            <p className="mx-auto max-w-xl text-muted-foreground text-balance">
              We've got answers. No corporate speak, promise.
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
