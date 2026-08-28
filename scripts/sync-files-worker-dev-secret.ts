#!/usr/bin/env bun

import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseConvexEnvOutput } from "./check-cloudflare";

const root = join(import.meta.dir, "..");
const convexPath = join(root, "packages/convex");
const devVarsPath = join(root, "apps/files-worker/.dev.vars");

export const mergeDotenvValue = (
  content: string,
  name: string,
  value: string
): string => {
  const assignment = new RegExp(`^\\s*${name}\\s*=`);
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const firstMatch = lines.findIndex((line) => assignment.test(line));
  const retained = lines.filter(
    (line, index) => !assignment.test(line) || index === firstMatch
  );
  if (firstMatch >= 0) {
    retained[firstMatch] = `${name}=${value}`;
    while (retained.at(-1) === "") {
      retained.pop();
    }
  } else {
    while (retained.at(-1) === "") {
      retained.pop();
    }
    retained.push(`${name}=${value}`);
  }
  return `${retained.join("\n")}\n`;
};

const main = async () => {
  // biome-ignore lint/correctness/noUndeclaredVariables: Bun global in Bun runtime
  const proc = Bun.spawn(
    [
      "bunx",
      "convex",
      "env",
      "get",
      "FILES_SIGNING_SECRET",
      "--deployment",
      "dev",
    ],
    { cwd: convexPath, stderr: "pipe", stdout: "pipe" }
  );
  await proc.exited;
  const result = parseConvexEnvOutput(
    await new Response(proc.stdout).text(),
    await new Response(proc.stderr).text(),
    proc.exitCode ?? 1
  );

  if (result.status !== "found") {
    throw new Error(
      result.status === "missing"
        ? "Convex dev FILES_SIGNING_SECRET is missing"
        : "Convex dev environment is unavailable"
    );
  }
  if (/[\r\n\0]/.test(result.value)) {
    throw new Error(
      "Convex dev FILES_SIGNING_SECRET has an unsafe dotenv value"
    );
  }

  const existing = await readFile(devVarsPath, "utf8").catch(() => "");
  await writeFile(
    devVarsPath,
    mergeDotenvValue(existing, "FILES_SIGNING_SECRET", result.value),
    { mode: 0o600 }
  );
  await chmod(devVarsPath, 0o600);
  console.log(
    "Synced Convex dev FILES_SIGNING_SECRET to ignored apps/files-worker/.dev.vars"
  );
};

if (import.meta.main) {
  await main();
}
