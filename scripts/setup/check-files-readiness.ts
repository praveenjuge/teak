#!/usr/bin/env bun
import {
  DISPATCH_ITEM_TYPES,
  FILES_IMPORT_MODES,
  FILES_NETWORK_OPS,
  type FilesCapabilities,
  type FilesEnvelope,
  MAINTENANCE_TASKS,
} from "@teak/files-protocol";
import { CRONS, cronTasksOn } from "../../packages/convex/cronSchedules";
import { signedOpRequest } from "../../packages/convex/storage/coreWorkerClient";
import { pollUntil } from "../release/release-cli.ts";

const includesAll = (
  reported: readonly string[] | undefined,
  required: readonly string[]
): boolean => required.every((value) => reported?.includes(value));

/** The deployed Worker can run everything this Convex will ask of it. */
const isReady = (data: FilesCapabilities): boolean =>
  data.ai &&
  data.images &&
  data.browser &&
  data.fetcher &&
  data.renderer &&
  data.rendererHealthy === true &&
  data.vectors &&
  data.workflows &&
  data.vectorTypes &&
  data.onboardingFiles &&
  includesAll(data.operations, FILES_NETWORK_OPS) &&
  includesAll(data.dispatchItems, DISPATCH_ITEM_TYPES) &&
  includesAll(data.importModes, FILES_IMPORT_MODES) &&
  includesAll(
    data.crons,
    cronTasksOn("cloudflare").map((task) => CRONS[task].name)
  ) &&
  includesAll(data.maintenanceTasks, MAINTENANCE_TASKS);

async function productionEnv(name: string): Promise<string> {
  const child = Bun.spawn(
    ["bun", "x", "convex", "env", "get", name, "--prod"],
    {
      cwd: new URL("../../packages/convex", import.meta.url).pathname,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const [output, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 || !output.trim()) {
    throw new Error(`Cannot read production ${name}`);
  }
  return output.trim();
}

if (process.argv.includes("--prod")) {
  process.env.FILES_BASE = await productionEnv("FILES_BASE");
  process.env.FILES_SIGNING_SECRET = await productionEnv(
    "FILES_SIGNING_SECRET"
  );
}

/** The Worker answered, but not ready; `reason` says why when it failed. */
class NotReady extends Error {
  readonly reason: string;
  constructor(failedWith?: string) {
    const reason = failedWith ? ` (the check failed with ${failedWith})` : "";
    super(`Core worker is not ready${reason}; backend deployment blocked.`);
    this.reason = reason;
  }
}

const checkReady = async (): Promise<void> => {
  let failedWith: string | undefined;
  try {
    const signed = await signedOpRequest({
      op: "capabilities",
      params: { checkRenderer: true },
    });
    const response = await fetch(signed.url, {
      ...signed,
      signal: AbortSignal.timeout(60_000),
    });
    const result = (await response
      .json()
      .catch(() => null)) as FilesEnvelope<FilesCapabilities> | null;
    if (response.ok && result?.ok === true && isReady(result.data)) {
      return;
    }
  } catch (error) {
    failedWith =
      error instanceof Error && /^[A-Za-z]{1,64}$/.test(error.name)
        ? error.name
        : "an error";
  }
  throw new NotReady(failedWith);
};

const RENDERER_ROLLOUT_MS = 20 * 60_000;
await pollUntil(checkReady, {
  // Without --wait, one check.
  timeoutMs: process.argv.includes("--wait") ? RENDERER_ROLLOUT_MS : 0,
  intervalMs: 15_000,
  retryOn: (error) => error instanceof NotReady,
  onRetry: (error) =>
    console.log(
      `Waiting for core-worker deployment readiness…${(error as NotReady).reason}`
    ),
});
console.log(
  "Core worker ready: required operations and dispatch items, AI, Images, Browser Run, the media renderer, the link fetcher, the vector index, workflows, cron tasks, the getting-started files and signing verified."
);
