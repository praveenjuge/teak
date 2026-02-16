import { Button } from "@teak/ui/components/ui/button";
import { ExternalLink, Github, Globe, Twitter } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { authors, getAuthor } from "@/lib/authors";
import { changelogCollection } from "@/lib/source";

interface AuthorPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return Object.keys(authors).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: AuthorPageProps): Promise<Metadata> {
  const { slug } = await params;
  const author = getAuthor(slug);

  if (!author) {
    return {
      title: "Author Not Found",
    };
  }

  return {
    title: `${author.name} - Teak Team`,
    description: author.bio,
    keywords: `${author.name}, teak author, teak team, ${author.role.toLowerCase()}`,
    openGraph: {
      title: `${author.name} - Teak Team`,
      description: author.bio,
      type: "profile",
      images: [
        {
          url: author.avatar,
          width: 200,
          height: 200,
          alt: author.name,
        },
      ],
    },
    twitter: {
      card: "summary",
      title: `${author.name} - Teak Team`,
      description: author.bio,
      images: [author.avatar],
    },
  };
}

export default async function AuthorPage({ params }: AuthorPageProps) {
  const { slug } = await params;
  const author = getAuthor(slug);

  if (!author) {
    notFound();
  }

  // Get all changelog entries (authored by default author for now)
  const sortedEntries = [...changelogCollection].sort((a, b) => {
    return b.batchNumber - a.batchNumber;
  });

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      <div className="mt-10 mb-12">
        {/* Author Header */}
        <div className="mb-8 flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left">
          <img
            alt={author.name}
            className="mb-4 rounded-full sm:mr-6 sm:mb-0"
            height={120}
            src={author.avatar}
            width={120}
          />
          <div>
            <h1 className="mb-1 font-bold text-3xl tracking-tight md:text-4xl">
              {author.name}
            </h1>
            <p className="mb-3 font-medium text-lg text-primary">
              {author.role}
            </p>
            <p className="mb-4 text-muted-foreground">{author.bio}</p>

            {/* Social Links */}
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              {author.social.twitter && (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={author.social.twitter}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <Twitter className="mr-1 h-4 w-4" />
                    Twitter
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              )}
              {author.social.github && (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={author.social.github}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <Github className="mr-1 h-4 w-4" />
                    GitHub
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              )}
              {author.social.website && (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={author.social.website}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <Globe className="mr-1 h-4 w-4" />
                    Website
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Changelog Contributions */}
        <div className="border-t pt-8">
          <h2 className="mb-6 font-semibold text-xl">
            Changelog Updates ({sortedEntries.length})
          </h2>
          <div className="space-y-4">
            {sortedEntries.map((entry) => (
              <Link
                className="block rounded-lg border bg-background p-4 transition-colors hover:border-primary/50 hover:bg-muted/50"
                href="/changelog"
                key={entry.batchNumber}
              >
                <p className="mb-1 text-muted-foreground text-sm">
                  {new Date(entry.endDate).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
                <h3 className="font-medium">{entry.title}</h3>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
