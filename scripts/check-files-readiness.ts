#!/usr/bin/env bun
import { IMPORT_MODES } from "../packages/convex/shared/importSources";
import { buildSignedWorkerOpRequest } from "../packages/convex/storage/filesWorkerClient";

const required = [
  "extract-animation-palette",
  "process-audio",
  "generate-text-metadata",
  "generate-link-metadata",
  "index-import-source",
  "read-import-markdown",
  "extract-import-files",
  "abort-multipart",
  "delete-objects",
  "freeze-object",
  "fetch-link-page",
  "store-remote-asset",
  "embed-upsert",
  "vector-delete",
  "vector-get",
  "vector-query",
  "vector-similar",
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
  // A new renderer image builds and rolls out after the Worker deploys.
  Date.now() + (process.argv.includes("--wait") ? 20 * 60_000 : 0);
for (;;) {
  let ready = false;
  try {
    const signed = await buildSignedWorkerOpRequest({
      op: "capabilities",
      // Starts a renderer Container when none is warm.
      params: { checkRenderer: true },
    });
    const response = await fetch(signed.url, {
      ...signed,
      signal: AbortSignal.timeout(60_000),
    });
    const result = (await response.json()) as {
      ok?: boolean;
      data?: {
        ai?: boolean;
        browser?: boolean;
        fetcher?: boolean;
        images?: boolean;
        importModes?: string[];
        operations?: string[];
        renderer?: boolean;
        rendererHealthy?: boolean;
        vectors?: boolean;
        vectorTypes?: boolean;
      };
    };
    ready =
      response.ok &&
      result.ok === true &&
      result.data?.ai === true &&
      result.data.images === true &&
      result.data.browser === true &&
      result.data.fetcher === true &&
      result.data.renderer === true &&
      result.data.rendererHealthy === true &&
      result.data.vectors === true &&
      result.data.vectorTypes === true &&
      required.every((op) => result.data?.operations?.includes(op)) &&
      IMPORT_MODES.every((mode) => result.data?.importModes?.includes(mode));
  } catch {
    // Never log signed URLs, request headers, or deployment secrets.
  }
  if (ready) {
    console.log(
      "Files worker ready: required operations, AI, Images, Browser Run, the media renderer, the link fetcher, the vector index, and signing verified."
    );
    break;
  }
  if (Date.now() >= deadline) {
    throw new Error("Files worker is not ready; backend deployment blocked.");
  }
  console.log("Waiting for files-worker deployment readiness…");
  await Bun.sleep(15_000);
}
