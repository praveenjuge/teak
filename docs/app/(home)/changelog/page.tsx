import type { Metadata } from "next";
import type { ComponentType } from "react";
import { changelog } from "@/lib/source";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "What's New in Teak",
  description:
    "See how we're making Teak better every week. Real updates, no fluff.",
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
  const sortedEntries = [...changelog].sort((a, b) => {
    return b.batchNumber - a.batchNumber;
  });

  return (
    <div className="container mx-auto max-w-2xl py-12 px-4">
      <div className="mb-12 mt-10 text-center max-w-md mx-auto">
        <h1 className="mb-4 font-bold text-4xl md:text-5xl text-balance tracking-tight">
          What&apos;s New
        </h1>
        <p className="text-lg text-muted-foreground text-balance mb-6">
          Real updates that make Teak better. No corporate fluff, promise.
        </p>
        <Button variant="outline" asChild>
          <a
            href="https://x.com/praveenjuge"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
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
              key={data.batchNumber}
              className="border rounded-xl p-7 bg-background"
            >
              <p className="text-muted-foreground mb-2">
                {formatDate(data.endDate)}
              </p>

              <h2 className="text-2xl font-semibold mb-4 text-balance">
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
