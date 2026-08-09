import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const positiveIntegerPattern = /^[1-9]\d*$/;

export function nextAppleBuildNumber(response) {
  if (!(response && Array.isArray(response.data))) {
    throw new Error("Expected an App Store Connect builds response.");
  }

  let maximum = 0n;
  for (const build of response.data) {
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
  const [filePath] = process.argv.slice(2);
  if (!filePath) {
    throw new Error("Usage: node scripts/apple-build-number.mjs <builds.json>");
  }
  const response = JSON.parse(fs.readFileSync(filePath, "utf8"));
  console.log(nextAppleBuildNumber(response));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
