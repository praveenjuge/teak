import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseVersion } from "./release-version.mjs";

const liveStates = new Set([
  "READY_FOR_DISTRIBUTION",
  "READY_FOR_SALE",
  "PROCESSING_FOR_DISTRIBUTION",
]);

export function issueTitle(version) {
  parseVersion(version);
  return `Apple release v${version}`;
}

export function exactIssue(issues, version) {
  const title = issueTitle(version);
  return issues.find((issue) => issue.title === title);
}

export function isLiveState(state) {
  return liveStates.has(String(state).trim().toUpperCase());
}

export function sanitizeAscOutput(value) {
  return String(value || "Unavailable.")
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
      "[redacted private key]"
    )
    .replace(
      /(^|\n)([^\n]*(?:authorization|password|private[_ -]?key|secret|token)[^:\n=]*[:=])[^\n]*/gi,
      "$1$2 [redacted]"
    )
    .slice(0, 6000)
    .trim();
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!(flag?.startsWith("--") && value !== undefined)) {
      throw new Error(`Invalid argument near ${flag ?? "end of command"}.`);
    }
    values[flag.slice(2)] = value;
  }
  return values;
}

function validateWorkflowUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error("Workflow URL must be an https://github.com URL.");
  }
  return url.toString();
}

function gh(args, { allowFailure = false } = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    env: process.env,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr.trim() || `gh ${args[0]} failed.`);
  }
  return result;
}

function listIssues(version) {
  const result = gh([
    "issue",
    "list",
    "--state",
    "all",
    "--search",
    `${issueTitle(version)} in:title`,
    "--limit",
    "100",
    "--json",
    "number,title,state,url",
  ]);
  return JSON.parse(result.stdout || "[]");
}

function readOptional(filePath) {
  if (!(filePath && fs.existsSync(filePath))) {
    return "Unavailable.";
  }
  return sanitizeAscOutput(fs.readFileSync(filePath, "utf8"));
}

function failureBody(values) {
  const platform = values.platform;
  if (!new Set(["IOS", "MAC_OS"]).has(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  const workflowUrl = validateWorkflowUrl(values["workflow-url"]);
  const workflowFile =
    platform === "IOS" ? "mobile-release.yml" : "safari-extension-release.yml";
  const status = readOptional(values["status-file"]);
  const doctor = readOptional(values["doctor-file"]);
  return `<!-- apple-release:v${values.version} -->
The ${platform} App Store release for v${values.version} reached a terminal workflow failure.

- App Store Connect app: ${values["app-id"]}
- Platform: ${platform}
- Workflow: ${workflowUrl}

Redacted asc status:

\`\`\`text
${status}
\`\`\`

asc review doctor remediation:

\`\`\`text
${doctor}
\`\`\`

Rerun after remediation:

\`\`\`bash
gh workflow run ${workflowFile} --ref main -f version=${values.version} -f dry_run=false
\`\`\``;
}

function reportFailure(values) {
  parseVersion(values.version);
  const body = failureBody(values);
  const issue = exactIssue(listIssues(values.version), values.version);
  if (!issue) {
    const created = gh([
      "issue",
      "create",
      "--title",
      issueTitle(values.version),
      "--body",
      body,
    ]);
    process.stdout.write(created.stdout);
    return;
  }
  if (issue.state === "CLOSED") {
    gh(["issue", "reopen", String(issue.number)]);
  }
  gh(["issue", "comment", String(issue.number), "--body", body]);
  console.log(issue.url);
}

function reportStatus(values) {
  parseVersion(values.version);
  const workflowUrl = validateWorkflowUrl(values["workflow-url"]);
  const issue = exactIssue(listIssues(values.version), values.version);
  if (!issue) {
    console.log(`No Apple release issue exists for v${values.version}.`);
    return;
  }

  const iosState = values["ios-state"].trim().toUpperCase();
  const safariState = values["safari-state"].trim().toUpperCase();
  const bothLive = isLiveState(iosState) && isLiveState(safariState);
  const body = `Apple release status check: iOS ${iosState}; Safari macOS ${safariState}. [Workflow](${workflowUrl})`;
  if (issue.state === "OPEN") {
    gh(["issue", "comment", String(issue.number), "--body", body]);
    if (bothLive) {
      gh([
        "issue",
        "close",
        String(issue.number),
        "--comment",
        "Both App Store versions are live. Closing the release issue.",
      ]);
    }
  }
  console.log(issue.url);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const values = parseArguments(args);
  if (command === "failure") {
    reportFailure(values);
    return;
  }
  if (command === "status") {
    reportStatus(values);
    return;
  }
  throw new Error("Expected failure or status command.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
