import type { Metadata } from "next";
import Image from "next/image";
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
import { Badge } from "@/components/Badge";

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
          revalidate: 1800, // Revalidate every 30 minutes
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
):
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info" {
  const variants = {
    feat: "success" as const,
    fix: "destructive" as const,
    docs: "info" as const,
    style: "warning" as const,
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
    <div className="container mx-auto max-w-4xl py-12 px-4">
      <div className="mb-12">
        <h1 className="text-4xl font-bold mb-4">Changelog</h1>
        <p className="text-xl text-muted-foreground">
          Stay updated with the latest changes and improvements to Teak.
        </p>
      </div>

      {Object.entries(groupedByMonth)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([monthKey, month]) => (
          <div key={monthKey} className="mb-12">
            <h2 className="text-2xl font-semibold mb-6 border-b pb-2">
              {month.name}
            </h2>

            <div className="space-y-4">
              {month.entries.map((entry) => (
                <div
                  key={entry.sha}
                  className="border rounded-lg p-6 hover:shadow-md transition-shadow bg-background"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      {entry.authorAvatar ? (
                        <Image
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

                      <h3 className="font-medium mb-2">{entry.description}</h3>

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
