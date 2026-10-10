import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const positiveIntegerPattern = /^[1-9]\d*$/;

// Accepts one builds response per platform so iOS and macOS share one counter.
export function nextAppleBuildNumber(...responses) {
  if (
    responses.length === 0 ||
    !responses.every((response) => response && Array.isArray(response.data))
  ) {
    throw new Error("Expected an App Store Connect builds response.");
  }

  let maximum = 0n;
  for (const build of responses.flatMap((response) => response.data)) {
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
      "Usage: node scripts/apple-build-number.mjs <builds.json> [more-builds.json...]"
    );
  }
  const responses = filePaths.map((filePath) =>
    JSON.parse(fs.readFileSync(filePath, "utf8"))
  );
  console.log(nextAppleBuildNumber(...responses));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
