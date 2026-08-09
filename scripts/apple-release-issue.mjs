import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseVersion } from "./release-version.mjs";

const liveStates = new Set(["READY_FOR_DISTRIBUTION", "READY_FOR_SALE"]);

const dashboardStart = "<!-- apple-release-dashboard:start -->";
const dashboardEnd = "<!-- apple-release-dashboard:end -->";

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

export function isStorefrontLive(state, storefrontVersion, targetVersion) {
  return (
    isLiveState(state) &&
    String(storefrontVersion).trim() === String(targetVersion).trim()
  );
}

export function openReleaseVersions(issues) {
  return issues
    .filter((issue) => issue.state === "OPEN")
    .map((issue) => /^Apple release v(\d+\.\d+\.\d+)$/.exec(issue.title)?.[1])
    .filter(Boolean)
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true })
    );
}

export function releaseDashboard(body, values) {
  const stateKey = [
    values["ios-state"],
    values["ios-store-version"],
    values["safari-state"],
    values["safari-store-version"],
  ]
    .map((value) =>
      String(value || "UNKNOWN")
        .trim()
        .toUpperCase()
    )
    .join("|");
  const block = `${dashboardStart}
<!-- apple-release-state:${stateKey} -->
## Current release status

| Platform | App Store Connect | Public storefront |
| --- | --- | --- |
| iOS | ${values["ios-state"]} | ${values["ios-store-version"] || "not live"} |
| Safari macOS | ${values["safari-state"]} | ${values["safari-store-version"] || "not live"} |

Last check: [GitHub Actions](${values["workflow-url"]})
${dashboardEnd}`;
  const current = String(body || "").match(
    /<!-- apple-release-state:([^>]+) -->/
  )?.[1];
  const expression = new RegExp(
    `${dashboardStart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${dashboardEnd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
  );
  const nextBody = expression.test(String(body || ""))
    ? String(body).replace(expression, block)
    : `${String(body || "").trim()}${body ? "\n\n" : ""}${block}`;
  return { body: nextBody, changed: current !== stateKey, stateKey };
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
    "number,title,state,url,body",
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
  const iosStoreVersion = values["ios-store-version"]?.trim() || "NOT_LIVE";
  const safariStoreVersion =
    values["safari-store-version"]?.trim() || "NOT_LIVE";
  const bothLive =
    isStorefrontLive(iosState, iosStoreVersion, values.version) &&
    isStorefrontLive(safariState, safariStoreVersion, values.version);
  const dashboard = releaseDashboard(issue.body, {
    ...values,
    "ios-state": iosState,
    "safari-state": safariState,
    "ios-store-version": iosStoreVersion,
    "safari-store-version": safariStoreVersion,
    "workflow-url": workflowUrl,
  });
  const transition = `Apple release status changed: iOS ${iosState} (storefront ${iosStoreVersion}); Safari macOS ${safariState} (storefront ${safariStoreVersion}). [Workflow](${workflowUrl})`;
  if (issue.state === "OPEN") {
    gh(["issue", "edit", String(issue.number), "--body", dashboard.body]);
    if (dashboard.changed) {
      gh(["issue", "comment", String(issue.number), "--body", transition]);
    }
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

function listOpenVersions() {
  const result = gh([
    "issue",
    "list",
    "--state",
    "open",
    "--search",
    '"Apple release v" in:title',
    "--limit",
    "100",
    "--json",
    "title,state",
  ]);
  process.stdout.write(
    `${JSON.stringify(openReleaseVersions(JSON.parse(result.stdout || "[]")))}\n`
  );
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
  if (command === "versions") {
    listOpenVersions();
    return;
  }
  throw new Error("Expected failure, status, or versions command.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
