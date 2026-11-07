// Opens, updates and closes the "Android release v<version>" issue for
// android-release.yml.
//   node scripts/release/android-release-issue.ts failure --version <x.y.z> --workflow-url <url> [--error-file <path>]
//   node scripts/release/android-release-issue.ts resolved --version <x.y.z> --workflow-url <url>
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { type ReleaseIssue, sanitizeAscOutput } from "./apple-release-issue.ts";
import { githubWorkflowUrl, parseArguments, required } from "./release-cli.ts";
import { parseVersion } from "./release-version.ts";

export function issueTitle(version: string) {
  parseVersion(version);
  return `Android release v${version}`;
}

export function failureBody({
  version,
  url,
  error,
}: {
  error: string;
  url: string | undefined;
  version: string;
}) {
  return `The Google Play release for v${version} failed.

- Workflow: ${githubWorkflowUrl(url)}

What Play or the workflow said (redacted):

\`\`\`text
${sanitizeAscOutput(error || "No error text; see the workflow log.")}
\`\`\`

Rerun once it's fixed:

\`\`\`bash
gh workflow run android-release.yml --ref main -f version=${version} -f dry_run=false
\`\`\``;
}

function gh(args: string[]) {
  const result = spawnSync("gh", args, { encoding: "utf8", env: process.env });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `gh ${args[0]} failed.`);
  }
  return result.stdout;
}

function findIssue(version: string): ReleaseIssue | undefined {
  const title = issueTitle(version);
  const issues: ReleaseIssue[] = JSON.parse(
    gh([
      "issue",
      "list",
      "--state",
      "all",
      "--search",
      `"${title}" in:title`,
      "--json",
      "number,title,state,url",
    ]) || "[]"
  );
  return issues.find((issue) => issue.title === title);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const values = parseArguments(args);
  const version = required(values.version, "version");
  const issue = findIssue(version);
  if (command === "failure") {
    const errorFile = values["error-file"];
    const error =
      errorFile && fs.existsSync(errorFile)
        ? fs.readFileSync(errorFile, "utf8")
        : "";
    const body = failureBody({
      version,
      url: values["workflow-url"],
      error,
    });
    if (!issue) {
      process.stdout.write(
        gh(["issue", "create", "--title", issueTitle(version), "--body", body])
      );
      return;
    }
    if (issue.state === "CLOSED") {
      gh(["issue", "reopen", String(issue.number)]);
    }
    gh(["issue", "comment", String(issue.number), "--body", body]);
    console.log(issue.url);
    return;
  }
  if (command === "resolved") {
    if (issue?.state === "OPEN") {
      gh([
        "issue",
        "close",
        String(issue.number),
        "--comment",
        `Submitted to Google Play by ${githubWorkflowUrl(values["workflow-url"])}.`,
      ]);
    }
    return;
  }
  throw new Error("Expected the failure or resolved command.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
