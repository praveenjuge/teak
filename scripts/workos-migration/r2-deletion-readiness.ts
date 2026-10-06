import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  callFilesWorkerJson,
  putObjectViaFilesWorker,
} from "@teak/convex/storage/filesWorkerClient";

// Prepare by default. Execution uses only an isolated development Worker and a
// new exact disposable key. Never connect this harness to the production Worker.
const { values } = parseArgs({
  options: {
    execute: { type: "boolean", default: false },
    environment: { type: "string" },
    report: { type: "string" },
  },
});
if (values.environment !== "development") {
  throw new Error("Pass --environment development explicitly.");
}
const base = process.env.FILES_BASE;
if (!base) {
  throw new Error("An isolated development FILES_BASE is required.");
}
const target = new URL(base);
if (
  target.username ||
  target.password ||
  target.search ||
  target.hash ||
  target.pathname !== "/" ||
  target.hostname === "files.teakvault.com" ||
  !(
    target.hostname.endsWith(".workers.dev") ||
    ["localhost", "127.0.0.1"].includes(target.hostname)
  ) ||
  !(
    target.protocol === "https:" ||
    (target.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(target.hostname))
  )
) {
  throw new Error("Use an isolated development Worker origin.");
}
if (process.env.R2_KEY_PREFIX !== "dev/") {
  throw new Error("R2_KEY_PREFIX must be dev/ for this harness.");
}
const key = `dev/users/workos-deletion-readiness/${randomUUID()}/proof.txt`;
const report = {
  origin: target.origin,
  key,
  startedAt: new Date().toISOString(),
  execution: values.execute,
  checks: [] as string[],
  passed: false,
  cleanup: "not_started",
  unproven: ["Server crash while an R2 write remains in flight"],
};
if (values.execute) {
  if (!(values.report && process.env.FILES_SIGNING_SECRET)) {
    throw new Error(
      "Execution requires --report and the isolated development signing secret."
    );
  }
  if (existsSync(values.report)) {
    throw new Error("Report path already exists.");
  }
  const originalFetch = globalThis.fetch;
  const head = async () => {
    const outcome = await callFilesWorkerJson<{
      exists: boolean;
      etag?: string;
    }>({ op: "head-object", params: { key } });
    if (outcome.kind !== "ok") {
      throw new Error("Readiness HEAD unavailable.");
    }
    return outcome.data;
  };
  const loseNextReply = (operation: "put" | "delete") => {
    let lost = false;
    globalThis.fetch = Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        const response = await originalFetch(input, init);
        const matches =
          operation === "put"
            ? init?.method === "PUT"
            : init?.method === "POST" &&
              typeof init.body === "string" &&
              JSON.parse(init.body).op === "delete-objects";
        if (!lost && matches && response.ok) {
          lost = true;
          throw new Error("simulated_client_reply_lost");
        }
        return response;
      },
      { preconnect: originalFetch.preconnect }
    );
  };
  try {
    if ((await head()).exists) {
      throw new Error("Disposable key unexpectedly exists.");
    }
    loseNextReply("put");
    let lostPut = false;
    try {
      await putObjectViaFilesWorker({
        key,
        body: new TextEncoder().encode("disposable readiness proof"),
        contentType: "text/plain",
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          error.message === "simulated_client_reply_lost"
        )
      ) {
        throw error;
      }
      lostPut = true;
    } finally {
      globalThis.fetch = originalFetch;
    }
    const before = await head();
    if (!(lostPut && before.exists && before.etag)) {
      throw new Error("Lost PUT reply proof failed.");
    }
    report.checks.push("lost_client_put_reply_preserves_committed_object");
    const freeze = await callFilesWorkerJson<{ frozen: boolean }>({
      op: "freeze-object",
      params: { key },
    });
    if (freeze.kind !== "ok" || !freeze.data.frozen) {
      throw new Error("R2 write still pending; keep deletion pending.");
    }
    let lateWriteDenied = false;
    try {
      await putObjectViaFilesWorker({
        key,
        body: new TextEncoder().encode("must be rejected"),
        contentType: "text/plain",
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          error.message === "files_worker_upload_error:409"
        )
      ) {
        throw error;
      }
      lateWriteDenied = true;
    }
    if (!lateWriteDenied || (await head()).etag !== before.etag) {
      throw new Error("Frozen late-write proof failed.");
    }
    report.checks.push("frozen_key_denies_late_write_without_changing_object");
    loseNextReply("delete");
    let lostDelete = false;
    try {
      await callFilesWorkerJson({
        op: "delete-objects",
        params: { keys: [key] },
      });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          error.message.includes("simulated_client_reply_lost")
        )
      ) {
        throw error;
      }
      lostDelete = true;
    } finally {
      globalThis.fetch = originalFetch;
    }
    if (!lostDelete) {
      throw new Error("Lost DELETE reply was not exercised.");
    }
    await callFilesWorkerJson({
      op: "delete-objects",
      params: { keys: [key] },
    });
    if ((await head()).exists) {
      throw new Error("Object survives retried deletion.");
    }
    report.checks.push("lost_client_delete_reply_retries_to_confirmed_absence");
    report.cleanup = "confirmed_absent";
    report.passed = true;
  } finally {
    globalThis.fetch = originalFetch;
    if (report.cleanup !== "confirmed_absent") {
      try {
        const frozen = await callFilesWorkerJson<{ frozen: boolean }>({
          op: "freeze-object",
          params: { key },
        });
        if (frozen.kind !== "ok" || !frozen.data.frozen) {
          report.cleanup = "pending_unknown_write";
        } else {
          await callFilesWorkerJson({
            op: "delete-objects",
            params: { keys: [key] },
          });
          report.cleanup = (await head()).exists
            ? "pending"
            : "confirmed_absent";
        }
      } catch {
        report.cleanup = "pending";
      }
    }
    writeFileSync(
      values.report,
      `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`,
      { flag: "wx", mode: 0o600 }
    );
  }
} else {
  console.log(
    JSON.stringify(
      {
        ...report,
        planned: [
          "Disposable PUT with simulated lost client reply",
          "Freeze then reject a late PUT without changing its ETag",
          "Delete with simulated lost reply, then retry and confirm absence",
        ],
      },
      null,
      2
    )
  );
}
