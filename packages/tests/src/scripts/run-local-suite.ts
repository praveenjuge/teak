#!/usr/bin/env bun
// `bun run e2e`: starts this checkout's local stack (scripts/dev/local-stack),
// warms it up, runs the Chromium and WebKit suites (or the e2e arguments
// given), and stops it. `bun run e2e:stack` (`stack`) only runs the stack.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { runLocalStack } from "@teak/scripts/dev/local-stack/run";

const TESTS = join(import.meta.dir, "../..");
const stackOnly = process.argv[2] === "stack";
// `bun run e2e -- --grep x` may pass the separator through.
const e2eArgs = stackOnly
  ? []
  : process.argv.slice(2).filter((arg, index) => index > 0 || arg !== "--");

const runs: string[][] =
  e2eArgs.length > 0
    ? [e2eArgs]
    : [
        ["--config", "e2e.config.ts"],
        ["--config", "e2e.webkit.config.ts"],
      ];

const e2e = (args: string[], env: NodeJS.ProcessEnv) =>
  new Promise<number>((resolve) => {
    const child = spawn("bunx", ["e2e", "run", ...args], {
      cwd: TESTS,
      env: { ...env, E2E_TELEMETRY_DISABLED: "1" },
      stdio: "inherit",
    });
    child.once("exit", (code) => resolve(code ?? 1));
  });

const suite = async (env: NodeJS.ProcessEnv): Promise<number> => {
  let exitCode = await e2e(["--config", "e2e.warmup.config.ts"], env);
  if (exitCode === 0) {
    for (const args of runs) {
      const code = await e2e(args, env);
      exitCode ||= code;
    }
  }
  return exitCode;
};

process.exit(await runLocalStack(stackOnly ? {} : { whileUp: suite }));
