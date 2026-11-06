import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  GUARDED_WORKFLOW_RPC_FUNCTIONS,
  isWorkflowRpcFunction,
  requiresWorkflowRpcGuard,
  WORKFLOW_RPC_FUNCTIONS,
} from "../../workflows/rpcAllowlist";

// The gateway runs only the functions on the allowlist, and the Core Worker
// is its only caller. The list has to name exactly the internal functions
// the Worker calls: one it misses fails a workflow step in production, and
// one nothing calls is a function the gateway exposes for no reason.

const WORKER_SOURCE = resolve(
  import.meta.dir,
  "../../../../apps/core-worker/src"
);
const CONVEX = resolve(import.meta.dir, "../..");

const workerFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return name === "test" ? [] : workerFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });

// `internal.workflows.steps.archive.mutations.recordPageArchive` is the
// function "workflows/steps/archive/mutations:recordPageArchive".
// A reference may break across lines before a dot.
const INTERNAL_REFERENCE = /\binternal((?:\s*\.[A-Za-z_$][\w$]*)+)/g;

const functionName = (reference: string) => {
  const parts = reference.replace(/\s/g, "").slice(1).split(".");
  const name = parts.pop();
  return `${parts.join("/")}:${name}`;
};

const workerCalls = () =>
  new Set(
    workerFiles(WORKER_SOURCE).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(INTERNAL_REFERENCE)].map(
        ([, reference]) => functionName(reference ?? "")
      )
    )
  );

interface RegisteredFunction {
  isAction?: boolean;
  isInternal?: boolean;
  isMutation?: boolean;
  isQuery?: boolean;
}

const registered = async (name: string) => {
  const [module, exportName] = name.split(":");
  const exported = (
    (await import(join(CONVEX, `${module}.ts`))) as Record<string, unknown>
  )[exportName ?? ""] as RegisteredFunction | undefined;
  return exported;
};

describe("workflow RPC allowlist", () => {
  test("names exactly the internal functions the Core Worker calls", () => {
    expect([...WORKFLOW_RPC_FUNCTIONS].sort()).toEqual(
      [...workerCalls()].sort()
    );
  });

  test.each([...WORKFLOW_RPC_FUNCTIONS])(
    "%s is a registered internal function",
    async (name) => {
      const fn = await registered(name);
      expect(
        Boolean(fn?.isInternal && (fn.isQuery || fn.isMutation || fn.isAction))
      ).toBe(true);
    }
  );

  test("guards only allowlisted mutations", async () => {
    expect(GUARDED_WORKFLOW_RPC_FUNCTIONS.size).toBeGreaterThan(0);
    for (const name of GUARDED_WORKFLOW_RPC_FUNCTIONS) {
      expect(isWorkflowRpcFunction(name)).toBe(true);
      expect(requiresWorkflowRpcGuard(name, {})).toBe(true);
      expect((await registered(name))?.isMutation).toBe(true);
    }
  });
});
