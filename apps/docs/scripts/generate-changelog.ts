import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { groq } from "@ai-sdk/groq";
import { generateText, Output } from "ai";
import { z } from "zod";

// Configuration
const COMMITS_PER_BATCH = 40;

/**
 * Changelog generation model
 * Uses openai/gpt-oss-120b which supports prompt caching for 50% cost savings
 */
const CHANGELOG_MODEL = groq("openai/gpt-oss-120b");

/**
 * System prompt for changelog generation
 * Static content - will be cached across batch processing requests
 */
const CHANGELOG_SYSTEM_PROMPT = `You are writing short changelog posts for Teak, a personal knowledge hub app.
Be concise and direct. Focus only on the most important user-facing changes.
Avoid fluff, marketing speak, or unnecessary detail. Keep everything brief.`;

// Types
interface GitHubCommit {
  author: {
    login: string;
  } | null;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  html_url: string;
  sha: string;
}

interface CommitBatch {
  batchNumber: number;
  commits: GitHubCommit[];
  endDate: Date;
  startDate: Date;
}

// Schema for AI-generated changelog summary
const changelogSchema = z.object({
  title: z
    .string()
    .describe(
      "A short, catchy title (4-7 words) that does NOT include months, dates, or years"
    ),
  summary: z
    .string()
    .describe(
      "A very brief summary in a friendly tone (2-3 sentences, max 60 words)"
    ),
  highlights: z
    .array(
      z.object({
        type: z
          .enum(["feature", "fix", "improvement", "other"])
          .describe("The type of change"),
        description: z
          .string()
          .describe("A brief description (under 15 words)"),
      })
    )
    .describe("Key highlights (3-4 items max)"),
});

// Fetch all commits from GitHub (paginated)
async function fetchAllCommits(): Promise<GitHubCommit[]> {
  const allCommits: GitHubCommit[] = [];
  let page = 1;
  const perPage = 100;

  console.log("Fetching commits from GitHub...");

  while (true) {
    const response = await fetch(
      `https://api.github.com/repos/praveenjuge/teak/commits?per_page=${perPage}&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Teak-Changelog-Generator",
          ...(process.env.GITHUB_TOKEN && {
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          }),
        },
      }
    );

    if (!response.ok) {
      if (response.status === 403) {
        console.warn(
          "GitHub API rate limit exceeded. Set GITHUB_TOKEN env var for higher limits."
        );
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const commits: GitHubCommit[] = await response.json();

    if (commits.length === 0) {
      break;
    }

    allCommits.push(...commits);
    console.log(`  Fetched page ${page} (${commits.length} commits)`);

    if (commits.length < perPage) {
      break;
    }

    page++;
  }

  console.log(`Total commits fetched: ${allCommits.length}`);
  return allCommits;
}

// Group commits into batches of N commits
function groupCommitsIntoBatches(commits: GitHubCommit[]): CommitBatch[] {
  const batches: CommitBatch[] = [];

  // Commits are returned newest first, reverse for chronological order
  const chronologicalCommits = [...commits].reverse();

  for (let i = 0; i < chronologicalCommits.length; i += COMMITS_PER_BATCH) {
    const batchCommits = chronologicalCommits.slice(i, i + COMMITS_PER_BATCH);
    const batchNumber = Math.floor(i / COMMITS_PER_BATCH) + 1;

    // Get date range for this batch
    const startDate = new Date(batchCommits[0].commit.author.date);
    const endDate = new Date(batchCommits.at(-1)?.commit.author.date ?? "");

    batches.push({
      batchNumber,
      startDate,
      endDate,
      commits: batchCommits,
    });
  }

  // Return in reverse order (newest first for display)
  return batches.reverse();
}

// Get existing changelog files
function getExistingChangelogFiles(dir: string): Set<number> {
  if (!existsSync(dir)) {
    return new Set();
  }
  const files = readdirSync(dir);
  return new Set(
    files
      .filter((f) => f.endsWith(".mdx"))
      .map((f) => Number.parseInt(f.replace(".mdx", ""), 10))
      .filter((n) => !Number.isNaN(n))
  );
}

// Format commit messages for AI prompt
function formatCommitsForPrompt(commits: GitHubCommit[]): string {
  return commits
    .map((c) => {
      const firstLine = c.commit.message.split("\n")[0];
      const author = c.author?.login || c.commit.author.name;
      return `- ${firstLine} (by ${author})`;
    })
    .join("\n");
}

// Generate AI summary for a batch
async function generateBatchSummary(batch: CommitBatch) {
  const commitsText = formatCommitsForPrompt(batch.commits);

  const result = await generateText({
    model: CHANGELOG_MODEL,
    // Static system prompt - will be cached across batch requests
    system: CHANGELOG_SYSTEM_PROMPT,
    // Dynamic content last for optimal caching
    prompt: `Generate a changelog summary for Teak based on these ${batch.commits.length} commits from ${batch.startDate.toLocaleDateString("en-US", { month: "long", day: "numeric" })} to ${batch.endDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}:

${commitsText}

Create an engaging title, summary, and highlights that communicate value to users. The title must avoid months, dates, and years (no calendar references) and should read like a compelling headline, not an "updates" label.`,
    experimental_output: Output.object({
      schema: changelogSchema,
    }),
  });

  return result.experimental_output;
}

// Format date for frontmatter
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// Generate MDX content
function generateMDXContent(
  batch: CommitBatch,
  summary: z.infer<typeof changelogSchema>
): string {
  const typeEmoji: Record<string, string> = {
    feature: "✨",
    fix: "🐛",
    improvement: "💪",
    docs: "📚",
    other: "🔧",
  };

  const typeLabel: Record<string, string> = {
    feature: "New Feature",
    fix: "Bug Fix",
    improvement: "Improvement",
    docs: "Documentation",
    other: "Other",
  };

  const highlights = summary.highlights
    .map(
      (h) => `- ${typeEmoji[h.type]} **${typeLabel[h.type]}**: ${h.description}`
    )
    .join("\n");

  return `---
title: "${summary.title}"
startDate: "${formatDate(batch.startDate)}"
endDate: "${formatDate(batch.endDate)}"
commitCount: ${batch.commits.length}
batchNumber: ${batch.batchNumber}
---

${summary.summary}

### Highlights

${highlights}
`;
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  const forceRegenerate = args.includes("--force") || args.includes("-f");

  const contentDir = join(process.cwd(), "content", "changelog");

  // In force mode, delete all existing changelog files first
  if (forceRegenerate) {
    console.log(
      "🔄 Force regenerate mode: deleting all existing changelog files...\n"
    );
    if (existsSync(contentDir)) {
      const existingFiles = readdirSync(contentDir).filter((f) =>
        f.endsWith(".mdx")
      );
      for (const file of existingFiles) {
        rmSync(join(contentDir, file));
      }
      console.log(`  Deleted ${existingFiles.length} existing changelog files`);
    }
  }

  // Ensure content directory exists
  if (!existsSync(contentDir)) {
    mkdirSync(contentDir, { recursive: true });
    console.log(`Created directory: ${contentDir}`);
  }

  // Get existing files (empty in force mode since we deleted them)
  const existingFiles = forceRegenerate
    ? new Set<number>()
    : getExistingChangelogFiles(contentDir);
  if (!forceRegenerate) {
    console.log(`Found ${existingFiles.size} existing changelog files`);
  }

  // Fetch all commits
  const commits = await fetchAllCommits();

  if (commits.length === 0) {
    console.log("No commits found");
    return;
  }

  // Group into batches
  const batches = groupCommitsIntoBatches(commits);
  console.log(
    `\nGrouped into ${batches.length} batches of ~${COMMITS_PER_BATCH} commits each`
  );

  // Filter to only batches that need generation
  const batchesToGenerate = batches.filter(
    (batch) => !existingFiles.has(batch.batchNumber)
  );

  if (batchesToGenerate.length === 0) {
    console.log(
      "\nAll batches already have changelog files. Nothing to generate."
    );
    return;
  }

  console.log(
    `\nGenerating ${batchesToGenerate.length} new changelog files...`
  );

  // Generate changelog for each missing batch
  for (const batch of batchesToGenerate) {
    console.log(
      `\nProcessing batch ${batch.batchNumber} (${batch.commits.length} commits)...`
    );

    try {
      const summary = await generateBatchSummary(batch);
      const mdxContent = generateMDXContent(batch, summary);
      const filePath = join(contentDir, `${batch.batchNumber}.mdx`);

      writeFileSync(filePath, mdxContent, "utf-8");
      console.log(`  ✓ Created ${batch.batchNumber}.mdx: "${summary.title}"`);
    } catch (error) {
      console.error(
        `  ✗ Failed to generate batch ${batch.batchNumber}:`,
        error
      );
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
