import Link from 'next/link';

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
            <div className="rounded-lg border border-fd-border bg-fd-card p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-fd-primary/10">
                <svg
                  className="h-6 w-6 text-fd-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                </svg>
              </div>
              <h3 className="mb-2 font-semibold text-xl">Self-Hosted</h3>
              <p className="text-fd-muted-foreground">
                Keep your data private and secure. Host Teak on your own
                infrastructure with full control over your personal knowledge.
              </p>
            </div>

            <div className="rounded-lg border border-fd-border bg-fd-card p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-fd-primary/10">
                <svg
                  className="h-6 w-6 text-fd-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                </svg>
              </div>
              <h3 className="mb-2 font-semibold text-xl">Lightning Fast</h3>
              <p className="text-fd-muted-foreground">
                Built with modern technologies like Bun, React 19, and
                PostgreSQL for exceptional performance and responsiveness.
              </p>
            </div>

            <div className="rounded-lg border border-fd-border bg-fd-card p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-fd-primary/10">
                <svg
                  className="h-6 w-6 text-fd-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                </svg>
              </div>
              <h3 className="mb-2 font-semibold text-xl">Cross-Platform</h3>
              <p className="text-fd-muted-foreground">
                Access your knowledge hub from anywhere with web, mobile, and
                desktop applications built with React Native and Expo.
              </p>
            </div>

            <div className="rounded-lg border border-fd-border bg-fd-card p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-fd-primary/10">
                <svg
                  className="h-6 w-6 text-fd-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                </svg>
              </div>
              <h3 className="mb-2 font-semibold text-xl">Smart Search</h3>
              <p className="text-fd-muted-foreground">
                Quickly find and rediscover your ideas with powerful search
                capabilities that understand your content.
              </p>
            </div>

            <div className="rounded-lg border border-fd-border bg-fd-card p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-fd-primary/10">
                <svg
                  className="h-6 w-6 text-fd-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                </svg>
              </div>
              <h3 className="mb-2 font-semibold text-xl">Modern Stack</h3>
              <p className="text-fd-muted-foreground">
                Built with the latest technologies including Hono.js, Drizzle
                ORM, and containerized with Docker for easy deployment.
              </p>
            </div>

            <div className="rounded-lg border border-fd-border bg-fd-card p-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-fd-primary/10">
                <svg
                  className="h-6 w-6 text-fd-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                </svg>
              </div>
              <h3 className="mb-2 font-semibold text-xl">Open Source</h3>
              <p className="text-fd-muted-foreground">
                Free and open source software that you can modify, extend, and
                contribute to. MIT licensed for maximum flexibility.
              </p>
            </div>
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
                <li className="flex items-center">
                  <svg
                    className="mr-3 h-5 w-5 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M5 13l4 4L19 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                  Complete source code access
                </li>
                <li className="flex items-center">
                  <svg
                    className="mr-3 h-5 w-5 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M5 13l4 4L19 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                  Host on your own infrastructure
                </li>
                <li className="flex items-center">
                  <svg
                    className="mr-3 h-5 w-5 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M5 13l4 4L19 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                  Web, mobile, and desktop apps
                </li>
                <li className="flex items-center">
                  <svg
                    className="mr-3 h-5 w-5 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M5 13l4 4L19 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                  Docker containerization
                </li>
                <li className="flex items-center">
                  <svg
                    className="mr-3 h-5 w-5 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M5 13l4 4L19 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                  MIT License - modify freely
                </li>
                <li className="flex items-center">
                  <svg
                    className="mr-3 h-5 w-5 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M5 13l4 4L19 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                  Community support
                </li>
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
            <details className="rounded-lg border border-fd-border bg-fd-card p-6">
              <summary className="cursor-pointer font-semibold text-lg">
                What is Teak?
              </summary>
              <p className="mt-4 text-fd-muted-foreground">
                Teak is a self-hosted personal knowledge hub that helps you
                collect, organize, and rediscover your ideas and inspirations.
                It&apos;s designed for creative minds who want to maintain their
                own private digital brain.
              </p>
            </details>

            <details className="rounded-lg border border-fd-border bg-fd-card p-6">
              <summary className="cursor-pointer font-semibold text-lg">
                Is it really free?
              </summary>
              <p className="mt-4 text-fd-muted-foreground">
                Yes! Teak is completely free and open source under the MIT
                license. You only pay for your own hosting infrastructure, which
                can be as little as $5/month on a VPS or even free if you host
                it locally.
              </p>
            </details>

            <details className="rounded-lg border border-fd-border bg-fd-card p-6">
              <summary className="cursor-pointer font-semibold text-lg">
                How do I self-host Teak?
              </summary>
              <p className="mt-4 text-fd-muted-foreground">
                Teak comes with Docker configuration for easy deployment. Simply
                clone the repository, configure your environment variables, and
                run `docker-compose up`. Detailed setup instructions are
                available in our documentation.
              </p>
            </details>

            <details className="rounded-lg border border-fd-border bg-fd-card p-6">
              <summary className="cursor-pointer font-semibold text-lg">
                What technologies does Teak use?
              </summary>
              <p className="mt-4 text-fd-muted-foreground">
                Teak is built with modern technologies: Bun runtime, Hono.js API
                server, React 19 with Vite for the web app, React Native with
                Expo for mobile, PostgreSQL 17 with Drizzle ORM, and Docker for
                containerization.
              </p>
            </details>

            <details className="rounded-lg border border-fd-border bg-fd-card p-6">
              <summary className="cursor-pointer font-semibold text-lg">
                Can I access my data from mobile devices?
              </summary>
              <p className="mt-4 text-fd-muted-foreground">
                Yes! Teak includes cross-platform applications: a web app,
                mobile apps for iOS and Android built with React Native and
                Expo, ensuring you can access your knowledge hub from any
                device.
              </p>
            </details>

            <details className="rounded-lg border border-fd-border bg-fd-card p-6">
              <summary className="cursor-pointer font-semibold text-lg">
                How do I contribute to Teak?
              </summary>
              <p className="mt-4 text-fd-muted-foreground">
                Teak is open source and welcomes contributions! Visit our GitHub
                repository to report issues, suggest features, or submit pull
                requests. We have a friendly community that&apos;s happy to help
                newcomers get started.
              </p>
            </details>

            <details className="rounded-lg border border-fd-border bg-fd-card p-6">
              <summary className="cursor-pointer font-semibold text-lg">
                What are the system requirements?
              </summary>
              <p className="mt-4 text-fd-muted-foreground">
                Teak requires Docker and Docker Compose for the easiest setup.
                For development, you&apos;ll need Bun 1.0+. The system is
                lightweight and can run on a modest VPS with 1GB RAM and 1 CPU
                core.
              </p>
            </details>
          </div>
        </div>
      </section>
    </main>
  );
}
