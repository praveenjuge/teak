import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const positiveIntegerPattern = /^[1-9]\d*$/;

export function nextAppleBuildNumber(...buildsPerPlatform) {
  if (
    buildsPerPlatform.length === 0 ||
    !buildsPerPlatform.every(
      (response) => response && Array.isArray(response.data)
    )
  ) {
    throw new Error("Expected an App Store Connect builds response.");
  }

  let maximum = 0n;
  for (const build of buildsPerPlatform.flatMap((response) => response.data)) {
    const value = String(build?.attributes?.version ?? "");
    if (!positiveIntegerPattern.test(value)) {
      throw new Error(`Unsafe App Store build number: ${value || "missing"}.`);
    }
    const current = BigInt(value);
    if (current > maximum) {
      maximum = current;
    }
  }
  return String(maximum + 1n);
}

function main() {
  const filePaths = process.argv.slice(2);
  if (filePaths.length === 0) {
    throw new Error(
      "Usage: node scripts/release/apple-build-number.ts <builds.json> [more-builds.json...]"
    );
  }
  const responses = filePaths.map((filePath) =>
    // The workflow's own asc output files, passed as arguments.
    // nosemgrep: javascript_pathtraversal_rule-non-literal-fs-filename
    JSON.parse(fs.readFileSync(filePath, "utf8"))
  );
  console.log(nextAppleBuildNumber(...responses));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
