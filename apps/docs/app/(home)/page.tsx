import Link from 'next/link';
import { FeatureCard } from '../../components/FeatureCard';
import { ChecklistItem } from '../../components/ChecklistItem';
import { FAQItem } from '../../components/FAQItem';

const features = [
  {
    icon: 'shield' as const,
    title: 'Self-Hosted',
    description: 'Keep your data private and secure. Host Teak on your own infrastructure with full control over your personal knowledge.'
  },
  {
    icon: 'lightning' as const,
    title: 'Lightning Fast',
    description: 'Built with modern technologies like Bun, React 19, and PostgreSQL for exceptional performance and responsiveness.'
  },
  {
    icon: 'mobile' as const,
    title: 'Cross-Platform',
    description: 'Access your knowledge hub from anywhere with web, mobile, and desktop applications built with React Native and Expo.'
  },
  {
    icon: 'search' as const,
    title: 'Smart Search',
    description: 'Quickly find and rediscover your ideas with powerful search capabilities that understand your content.'
  },
  {
    icon: 'stack' as const,
    title: 'Modern Stack',
    description: 'Built with the latest technologies including Hono.js, Drizzle ORM, and containerized with Docker for easy deployment.'
  },
  {
    icon: 'heart' as const,
    title: 'Open Source',
    description: 'Free and open source software that you can modify, extend, and contribute to. MIT licensed for maximum flexibility.'
  }
];

const faqs = [
  {
    question: 'What is Teak?',
    answer: "Teak is a self-hosted personal knowledge hub that helps you collect, organize, and rediscover your ideas and inspirations. It's designed for creative minds who want to maintain their own private digital brain."
  },
  {
    question: 'Is it really free?',
    answer: 'Yes! Teak is completely free and open source under the MIT license. You only pay for your own hosting infrastructure, which can be as little as $5/month on a VPS or even free if you host it locally.'
  },
  {
    question: 'How do I self-host Teak?',
    answer: 'Teak comes with Docker configuration for easy deployment. Simply clone the repository, configure your environment variables, and run `docker-compose up`. Detailed setup instructions are available in our documentation.'
  },
  {
    question: 'What technologies does Teak use?',
    answer: 'Teak is built with modern technologies: Bun runtime, Hono.js API server, React 19 with Vite for the web app, React Native with Expo for mobile, PostgreSQL 17 with Drizzle ORM, and Docker for containerization.'
  },
  {
    question: 'Can I access my data from mobile devices?',
    answer: 'Yes! Teak includes cross-platform applications: a web app, mobile apps for iOS and Android built with React Native and Expo, ensuring you can access your knowledge hub from any device.'
  },
  {
    question: 'How do I contribute to Teak?',
    answer: "Teak is open source and welcomes contributions! Visit our GitHub repository to report issues, suggest features, or submit pull requests. We have a friendly community that's happy to help newcomers get started."
  },
  {
    question: 'What are the system requirements?',
    answer: "Teak requires Docker and Docker Compose for the easiest setup. For development, you'll need Bun 1.0+. The system is lightweight and can run on a modest VPS with 1GB RAM and 1 CPU core."
  }
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero Section */}
      <section className="bg-gradient-to-b from-fd-background to-fd-muted/20 py-16 md:py-24">
        <div className="container mx-auto px-4 text-center">
          <h1 className="mb-6 bg-gradient-to-r from-fd-primary to-fd-primary/70 bg-clip-text font-bold text-4xl text-transparent md:text-6xl">
            Teak
          </h1>
          <p className="mx-auto mb-8 max-w-3xl text-fd-muted-foreground text-xl md:text-2xl">
            A streamlined personal knowledge hub designed to help creative minds
            effortlessly collect, remember, and rediscover their most important
            ideas and inspirations.
          </p>
          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <Link
              className="inline-flex items-center justify-center rounded-lg bg-fd-primary px-6 py-3 font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
              href="/docs"
            >
              Get Started
            </Link>
            <a
              className="inline-flex items-center justify-center rounded-lg border border-fd-border px-6 py-3 font-medium text-fd-foreground transition-colors hover:bg-fd-muted"
              href="https://github.com/praveenjuge/teak"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl md:text-4xl">
              Everything you need for personal knowledge management
            </h2>
            <p className="mx-auto max-w-2xl text-fd-muted-foreground text-xl">
              Teak combines the power of modern web technologies with thoughtful
              design to create the perfect personal knowledge hub.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <FeatureCard
                key={index}
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="bg-fd-muted/20 py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl md:text-4xl">
              Simple, Self-Hosted Pricing
            </h2>
            <p className="mx-auto max-w-2xl text-fd-muted-foreground text-xl">
              Teak is completely free and open source. Just host it yourself and
              you&apos;re ready to go.
            </p>
          </div>

          <div className="mx-auto max-w-lg">
            <div className="rounded-lg border border-fd-border bg-fd-card p-8 text-center">
              <h3 className="mb-4 font-bold text-2xl">Self-Hosted</h3>
              <div className="mb-6 font-bold text-4xl">
                $0
                <span className="font-normal text-fd-muted-foreground text-lg">
                  /forever
                </span>
              </div>
              <ul className="mb-8 space-y-3 text-left">
                <ChecklistItem>Complete source code access</ChecklistItem>
                <ChecklistItem>Host on your own infrastructure</ChecklistItem>
                <ChecklistItem>Web, mobile, and desktop apps</ChecklistItem>
                <ChecklistItem>Docker containerization</ChecklistItem>
                <ChecklistItem>MIT License - modify freely</ChecklistItem>
                <ChecklistItem>Community support</ChecklistItem>
              </ul>
              <Link
                className="inline-flex w-full items-center justify-center rounded-lg bg-fd-primary px-6 py-3 font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
                href="/docs"
              >
                Get Started Now
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl md:text-4xl">
              Frequently Asked Questions
            </h2>
            <p className="mx-auto max-w-2xl text-fd-muted-foreground text-xl">
              Everything you need to know about Teak.
            </p>
          </div>

          <div className="mx-auto max-w-3xl space-y-6">
            {faqs.map((faq, index) => (
              <FAQItem key={index} question={faq.question} answer={faq.answer} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
