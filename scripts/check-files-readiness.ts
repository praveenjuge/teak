#!/usr/bin/env bun
/** Read-only deployment gate: the worker must support the backend's byte paths. */
import { buildSignedWorkerOpRequest } from "../packages/convex/storage/filesWorkerClient";

const required = [
  "transcribe-audio",
  "index-import-source",
  "read-import-markdown",
  "extract-import-files",
  "abort-multipart",
  "delete-objects",
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
      data?: { operations?: string[]; ai?: boolean; images?: boolean };
    };
    ready =
      response.ok &&
      result.ok === true &&
      result.data?.ai === true &&
      result.data.images === true &&
      required.every((op) => result.data?.operations?.includes(op));
  } catch {
    // Never log signed URLs, request headers, or deployment secrets.
  }
  if (ready) {
    console.log(
      "Files worker ready: required operations, AI, Images, and signing verified."
    );
    break;
  }
  if (Date.now() >= deadline) {
    throw new Error("Files worker is not ready; backend deployment blocked.");
  }
  console.log("Waiting for files-worker deployment readiness…");
  await Bun.sleep(15_000);
}
