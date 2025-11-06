import type { Metadata } from "next";
import React from "react";
import {
  Sparkles,
  Bug,
  BookOpen,
  Palette,
  RefreshCw,
  TestTube,
  Wrench,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  author: {
    login: string;
    avatar_url: string;
  } | null;
  html_url: string;
}

interface ChangelogEntry {
  sha: string;
  message: string;
  type:
    | "feat"
    | "fix"
    | "docs"
    | "style"
    | "refactor"
    | "test"
    | "chore"
    | "other";
  scope?: string;
  description: string;
  author: string;
  authorAvatar?: string;
  date: string;
  url: string;
}

export const metadata: Metadata = {
  title: "Changelog",
  description: "Latest updates and changes to Teak",
};

async function fetchCommits(): Promise<GitHubCommit[]> {
  try {
    const response = await fetch(
      "https://api.github.com/repos/praveenjuge/teak/commits?per_page=50",
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Teak-Docs",
          // Add GitHub token if available for higher rate limits
          ...(process.env.GITHUB_TOKEN && {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          }),
        },
        next: {
          tags: ["github-commits"], // Enable tag-based revalidation
        },
      }
    );

    if (!response.ok) {
      // Log more detailed error information
      console.error(
        `GitHub API error: ${response.status} ${response.statusText}`
      );

      if (response.status === 403) {
        console.warn(
          "GitHub API rate limit exceeded. Consider adding a GITHUB_TOKEN environment variable."
        );
      }

      throw new Error(`GitHub API error: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    console.error("Failed to fetch commits:", error);

    // Return empty array instead of throwing to prevent page crashes
    return [];
  }
}

function parseCommitMessage(message: string): {
  type: ChangelogEntry["type"];
  scope?: string;
  description: string;
} {
  // Parse conventional commit format: type(scope): description
  const conventionalCommitRegex =
    /^(feat|fix|docs|style|refactor|test|chore)(\([^)]+\))?: (.+)$/;
  const match = message.match(conventionalCommitRegex);

  if (match) {
    const [, type, scopeWithParens, description] = match;
    const scope = scopeWithParens?.slice(1, -1); // Remove parentheses
    return {
      type: type as ChangelogEntry["type"],
      scope,
      description: description.trim(),
    };
  }

  // Fallback for non-conventional commits
  return {
    type: "other",
    description: message.split("\n")[0].trim(),
  };
}

function formatCommits(commits: GitHubCommit[]): ChangelogEntry[] {
  return commits.map((commit) => {
    const parsed = parseCommitMessage(commit.commit.message);

    return {
      sha: commit.sha,
      message: commit.commit.message,
      ...parsed,
      author: commit.author?.login || commit.commit.author.name,
      authorAvatar: commit.author?.avatar_url,
      date: commit.commit.author.date,
      url: commit.html_url,
    };
  });
}

function getTypeIcon(type: ChangelogEntry["type"]): React.JSX.Element {
  const iconProps = { className: "h-3 w-3" };
  const icons = {
    feat: <Sparkles {...iconProps} />,
    fix: <Bug {...iconProps} />,
    docs: <BookOpen {...iconProps} />,
    style: <Palette {...iconProps} />,
    refactor: <RefreshCw {...iconProps} />,
    test: <TestTube {...iconProps} />,
    chore: <Wrench {...iconProps} />,
    other: <FileText {...iconProps} />,
  };
  return icons[type];
}

function getTypeVariant(
  type: ChangelogEntry["type"]
): "default" | "secondary" | "destructive" | "outline" {
  const variants = {
    feat: "default" as const,
    fix: "destructive" as const,
    docs: "secondary" as const,
    style: "outline" as const,
    refactor: "secondary" as const,
    test: "outline" as const,
    chore: "secondary" as const,
    other: "outline" as const,
  };
  return variants[type];
}

export default async function ChangelogPage() {
  const commits = await fetchCommits();
  const changelog = formatCommits(commits);

  // Group commits by month
  const groupedByMonth = changelog.reduce(
    (acc, entry) => {
      const date = new Date(entry.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const monthName = date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
      });

      if (!acc[monthKey]) {
        acc[monthKey] = {
          name: monthName,
          entries: [],
        };
      }

      acc[monthKey].entries.push(entry);
      return acc;
    },
    {} as Record<string, { name: string; entries: ChangelogEntry[] }>
  );

  return (
    <div className="container mx-auto max-w-xl py-12 px-4">
      <div className="mb-12 mt-10 text-center max-w-sm mx-auto">
        <h1 className="mb-4 font-bold text-4xl md:text-5xl text-balance tracking-tight">
          Changelog
        </h1>
        <p className="text-base text-muted-foreground text-balance mb-6">
          Stay updated with the latest changes and improvements to Teak.
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

      {Object.entries(groupedByMonth)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([monthKey, month]) => (
          <div key={monthKey} className="mb-12">
            <h2 className="text-2xl font-semibold mb-6 border-b pb-2 text-balance">
              {month.name}
            </h2>

            <div className="space-y-4">
              {month.entries.map((entry) => (
                <div
                  key={entry.sha}
                  className="border rounded-lg p-6 hover:shadow-md transition-shadow bg-background"
                >
                  <div className="flex items-start gap-4">
                    <div className="shrink-0">
                      {entry.authorAvatar ? (
                        <img
                          src={entry.authorAvatar}
                          alt={entry.author}
                          width={32}
                          height={32}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                          <span className="text-sm font-medium">
                            {entry.author.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge
                          variant={getTypeVariant(entry.type)}
                          className="gap-1"
                        >
                          {getTypeIcon(entry.type)}
                          {entry.type}
                          {entry.scope && (
                            <span className="opacity-75">({entry.scope})</span>
                          )}
                        </Badge>

                        <span className="text-sm text-muted-foreground">
                          by {entry.author}
                        </span>
                      </div>

                      <h3 className="font-medium mb-2 text-balance">
                        {entry.description}
                      </h3>

                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <a
                          href={entry.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-foreground transition-colors"
                        >
                          View commit →
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

      {changelog.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            No changelog entries available at the moment.
          </p>
        </div>
      )}
    </div>
  );
}
