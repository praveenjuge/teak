import type { Metadata } from "next";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { changelogCollection } from "@/lib/source";

export const metadata: Metadata = {
  title: "What's New in Teak",
  description:
    "See how we're making Teak better every week. Real updates, no fluff.",
  openGraph: {
    title: "What's New in Teak",
    description:
      "See how we're making Teak better every week. Real updates, no fluff.",
    type: "website",
    siteName: "Teak",
    locale: "en_US",
    images: [
      {
        url: "/hero-image.png",
        width: 1200,
        height: 630,
        alt: "Teak Changelog",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "What's New in Teak",
    description:
      "See how we're making Teak better every week. Real updates, no fluff.",
    images: ["/hero-image.png"],
  },
};

interface ChangelogEntry {
  title: string;
  endDate: string;
  batchNumber: number;
  body: ComponentType;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function ChangelogPage() {
  // Sort entries by batchNumber descending (newest first)
  const sortedEntries = [...changelogCollection].sort((a, b) => {
    return b.batchNumber - a.batchNumber;
  });

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      <div className="mx-auto mt-10 mb-12 max-w-md text-center">
        <h1 className="mb-4 text-balance font-bold text-4xl tracking-tight md:text-5xl">
          What&apos;s New
        </h1>
        <p className="mb-6 text-balance text-lg text-muted-foreground">
          Real updates that make Teak better. No corporate fluff, promise.
        </p>
        <Button asChild variant="outline">
          <a
            href="https://x.com/praveenjuge"
            rel="noopener noreferrer"
            target="_blank"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Follow on X
          </a>
        </Button>
      </div>

      <div className="space-y-8">
        {sortedEntries.map((entry) => {
          const data = entry as unknown as ChangelogEntry;
          const MDXContent = data.body;

          return (
            <article
              className="rounded-xl border bg-background p-7"
              key={data.batchNumber}
            >
              <p className="mb-2 text-muted-foreground">
                {formatDate(data.endDate)}
              </p>

              <h2 className="mb-4 text-balance font-semibold text-2xl">
                {data.title}
              </h2>

              <div className="prose max-w-none">
                <MDXContent />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
