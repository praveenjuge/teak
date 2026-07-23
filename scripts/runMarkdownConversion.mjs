import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 20 * 60 * 1000;

function run(functionName, args) {
  const result = spawnSync(
    "bunx",
    ["convex", "run", functionName, JSON.stringify(args)],
    { encoding: "utf8" }
  );
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (result.status !== 0) {
    throw new Error(stderr || stdout || `${functionName} failed`);
  }
  return stdout ? JSON.parse(stdout) : null;
}

function pages(functionName) {
  const rows = [];
  let cursor = null;
  do {
    const page = run(functionName, { cursor, limit: 500 });
    rows.push(...page.page);
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
  return rows;
}

function totals(rows) {
  const result = {
    candidate: rows.length,
    converted: 0,
    failed: 0,
    inProgress: 0,
    pending: 0,
  };
  for (const row of rows) {
    if (row.status === "converted") {
      result.converted += 1;
    }
    if (row.status === "failed") {
      result.failed += 1;
    }
    if (row.status === "in_progress") {
      result.inProgress += 1;
    }
    if (row.status === "pending") {
      result.pending += 1;
    }
  }
  return result;
}

const startedAt = Date.now();
const untracked = pages("markdownDocumentMigration:untrackedCandidatePage");
if (untracked.length > 0) {
  throw new Error(
    `Markdown conversion seed missed ${untracked.length} candidate(s)`
  );
}

while (true) {
  run("markdownDocumentMigration:resumeCampaign", { limit: 50 });
  const audits = pages("markdownDocumentMigration:statusPage");
  const status = totals(audits);
  console.log(JSON.stringify(status));

  if (status.pending === 0 && status.inProgress === 0) {
    if (status.failed > 0) {
      const failures = audits
        .filter((audit) => audit.status === "failed")
        .map((audit) => ({
          auditId: audit._id,
          cardId: audit.cardId,
          failureReason: audit.failureReason,
          retryable: audit.retryable,
        }));
      console.error(JSON.stringify({ failures }, null, 2));
      process.exit(1);
    }
    const verification = pages("markdownDocumentMigration:verifyPage");
    const invalid = verification.filter((row) => !row.valid);
    if (invalid.length > 0) {
      console.error(JSON.stringify({ invalid }, null, 2));
      process.exit(1);
    }
    console.log(
      JSON.stringify({
        migration: "complete",
        verified: verification.length,
      })
    );
    break;
  }

  if (Date.now() - startedAt > TIMEOUT_MS) {
    throw new Error("Markdown conversion campaign timed out");
  }
  await sleep(POLL_INTERVAL_MS);
}
