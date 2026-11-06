// Opens, updates and closes the "Android release v<version>" issue for
// android-release.yml.
//   node scripts/release/android-release-issue.ts failure --version <x.y.z> --workflow-url <url> [--error-file <path>]
//   node scripts/release/android-release-issue.ts resolved --version <x.y.z> --workflow-url <url>
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { sanitizeAscOutput } from "./apple-release-issue.ts";
import { parseVersion } from "./release-version.ts";

export function issueTitle(version) {
  parseVersion(version);
  return `Android release v${version}`;
}

function workflowUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error("Workflow URL must be an https://github.com URL.");
  }
  return url.toString();
}

export function failureBody({ version, url, error }) {
  return `The Google Play release for v${version} failed.

- Workflow: ${workflowUrl(url)}

What Play or the workflow said (redacted):

\`\`\`text
${sanitizeAscOutput(error || "No error text; see the workflow log.")}
\`\`\`

Rerun once it's fixed:

\`\`\`bash
gh workflow run android-release.yml --ref main -f version=${version} -f dry_run=false
\`\`\``;
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", env: process.env });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `gh ${args[0]} failed.`);
  }
  return result.stdout;
}

function findIssue(version) {
  const title = issueTitle(version);
  const issues = JSON.parse(
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
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!(args[index]?.startsWith("--") && args[index + 1] !== undefined)) {
      throw new Error(
        `Invalid argument near ${args[index] ?? "end of command"}.`
      );
    }
    values[args[index].slice(2)] = args[index + 1];
  }
  const issue = findIssue(values.version);
  if (command === "failure") {
    const errorFile = values["error-file"];
    const error =
      errorFile && fs.existsSync(errorFile)
        ? fs.readFileSync(errorFile, "utf8")
        : "";
    const body = failureBody({
      version: values.version,
      url: values["workflow-url"],
      error,
    });
    if (!issue) {
      process.stdout.write(
        gh([
          "issue",
          "create",
          "--title",
          issueTitle(values.version),
          "--body",
          body,
        ])
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
        `Submitted to Google Play by ${workflowUrl(values["workflow-url"])}.`,
      ]);
    }
    return;
  }
  throw new Error("Expected the failure or resolved command.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
