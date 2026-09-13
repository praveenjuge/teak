#!/usr/bin/env bun
/** Read-only deployment gate: the worker must support the backend's byte paths. */
import { FILES_PROCESSOR_VERSION } from "@teak/files-protocol";
import { buildSignedWorkerOpRequest } from "../packages/convex/storage/filesWorkerClient";

// Every op Convex calls. Keep in sync with `op: "` call sites under
// packages/convex; the backend deploy blocks until the worker serves them.
const required = [
  "abort-multipart",
  "analyze-image",
  "build-export",
  "complete-multipart",
  "create-multipart",
  "delete-object",
  "delete-objects",
  "extract-import-files",
  "finalize-image-upload",
  "finalize-upload",
  "generate-image-metadata",
  "head-object",
  "index-import-source",
  "inspect",
  "list-objects",
  "read-import-markdown",
  "transcribe-audio",
];

// Feature flags the backend cut over to.
const requiredFeatures = [
  "verified-finalization",
  "worker-import-transport",
  "verified-text-reads",
  "media-facts",
  "ai-receipts",
];

async function productionEnv(name: string): Promise<string> {
  const child = Bun.spawn(
    ["bun", "x", "convex", "env", "get", name, "--prod"],
    {
      cwd: new URL("../packages/convex", import.meta.url).pathname,
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

const deadline =
  Date.now() + (process.argv.includes("--wait") ? 10 * 60_000 : 0);
for (;;) {
  let ready = false;
  try {
    const signed = await buildSignedWorkerOpRequest({
      op: "capabilities",
      params: {},
    });
    const response = await fetch(signed.url, {
      ...signed,
      signal: AbortSignal.timeout(15_000),
    });
    const result = (await response.json()) as {
      ok?: boolean;
      data?: {
        operations?: string[];
        ai?: boolean;
        images?: boolean;
        features?: string[];
        processorVersion?: string;
      };
    };
    ready =
      response.ok &&
      result.ok === true &&
      result.data?.ai === true &&
      result.data.images === true &&
      result.data.processorVersion === FILES_PROCESSOR_VERSION &&
      required.every((op) => result.data?.operations?.includes(op)) &&
      requiredFeatures.every((feature) =>
        result.data?.features?.includes(feature)
      );
  } catch {
    // Never log signed URLs, request headers, or deployment secrets.
  }
  if (ready) {
    console.log(
      "Files worker ready: required operations, features, processor version, AI, Images, and signing verified."
    );
    break;
  }
  if (Date.now() >= deadline) {
    throw new Error("Files worker is not ready; backend deployment blocked.");
  }
  console.log("Waiting for files-worker deployment readiness…");
  await Bun.sleep(15_000);
}
