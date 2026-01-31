import type { Metadata } from "next";
import Link from "next/link";
import { authors } from "@/lib/authors";

export const metadata: Metadata = {
  title: "Team",
  description: "Meet the team behind Teak, the visual bookmarking platform.",
  keywords: "teak team, teak authors, teak developers, who made teak",
  openGraph: {
    title: "Teak Team",
    description: "Meet the team behind Teak, the visual bookmarking platform.",
    type: "website",
    siteName: "Teak",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "Teak Team",
    description: "Meet the team behind Teak, the visual bookmarking platform.",
  },
};

export default function AuthorsPage() {
  const authorList = Object.values(authors);

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      <div className="mx-auto mt-10 mb-12 max-w-md text-center">
        <h1 className="mb-4 text-balance font-bold text-4xl tracking-tight md:text-5xl">
          Team
        </h1>
        <p className="text-balance text-lg text-muted-foreground">
          The people building Teak
        </p>
      </div>

      <div className="grid gap-6">
        {authorList.map((author) => (
          <Link
            className="flex items-center gap-4 rounded-xl border bg-background p-6 transition-colors hover:border-primary/50 hover:bg-muted/50"
            href={`/authors/${author.id}`}
            key={author.id}
          >
            <img
              alt={author.name}
              className="rounded-full"
              height={64}
              src={author.avatar}
              width={64}
            />
            <div>
              <h2 className="font-semibold text-lg">{author.name}</h2>
              <p className="text-primary text-sm">{author.role}</p>
              <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
                {author.bio}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
