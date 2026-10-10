import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.resolve(import.meta.dir, "./publish-apple.sh");

const platforms = {
  mac: {
    directory: "apps/mac/assets/screenshots/en-US",
    displayType: "APP_DESKTOP",
  },
  iphone: {
    directory: "apps/mobile/store/apple/screenshot/en-US/APP_IPHONE_67",
    displayType: "APP_IPHONE_67",
  },
};

function run(
  existingMatches: boolean,
  invalidLocal = false,
  uploadFails = false,
  assetFails = false,
  platform: keyof typeof platforms = "mac"
) {
  const root = mkdtempSync(path.join(tmpdir(), "teak-store-screenshots-"));
  const assets = path.join(root, platforms[platform].directory);
  mkdirSync(assets, { recursive: true });
  mkdirSync(path.join(root, "apps/mac"), { recursive: true });
  mkdirSync(path.join(root, "bin"));
  writeFileSync(
    path.join(root, "apps/mac/store.config.json"),
    JSON.stringify({ locale: "en-US" })
  );
  const bytes = Buffer.from("screenshot fixture");
  writeFileSync(path.join(assets, "01-library.png"), bytes);
  const attributes = {
    fileName: "01-library.png",
    sourceFileChecksum: createHash("md5").update(bytes).digest("hex"),
    assetDeliveryState: { state: assetFails ? "FAILED" : "COMPLETE" },
  };
  writeFileSync(
    path.join(root, "remote.json"),
    JSON.stringify({
      sets: [
        {
          set: {
            attributes: {
              screenshotDisplayType: platforms[platform].displayType,
            },
          },
          screenshots: [{ attributes }],
        },
      ],
    })
  );
  const asc = path.join(root, "bin/asc");
  writeFileSync(
    asc,
    `#!/usr/bin/env bun
import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync("calls.jsonl", JSON.stringify(args) + "\\n");
if (args[0] === "localizations") console.log(JSON.stringify({data:[{id:"locale-id",attributes:{locale:"en-US"}}]}));
else if (args[1] === "validate") { if (${invalidLocal}) process.exit(1); console.log("{}"); }
else if (args[1] === "upload") { if (${uploadFails}) process.exit(1); fs.writeFileSync("uploaded", "yes"); console.log("{}"); }
else if (args[1] === "list") {
  const remote = JSON.parse(fs.readFileSync("remote.json", "utf8"));
  if (!${existingMatches} && !fs.existsSync("uploaded")) remote.sets[0].screenshots[0].attributes.sourceFileChecksum = "stale-checksum";
  console.log(JSON.stringify(remote));
}
else process.exit(2);
`
  );
  chmodSync(asc, 0o755);
  const result = Bun.spawnSync(["bash", script, platform, "version-id"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
      RUNNER_TEMP: root,
      GITHUB_STEP_SUMMARY: path.join(root, "summary"),
    },
  });
  const calls = readFileSync(path.join(root, "calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  return { result, calls, root };
}

test("preserves an identical completed screenshot set on rerun", () => {
  const { result, calls, root } = run(true);
  expect(result.exitCode).toBe(0);
  expect(calls.some((args) => args[1] === "upload")).toBe(false);
  expect(readFileSync(path.join(root, "summary"), "utf8")).toContain(
    "checksum matched"
  );
});

test("replaces stale screenshots and verifies the uploaded bytes before completing", () => {
  const { result, calls } = run(false);
  expect(result.exitCode).toBe(0);
  expect(calls.find((args) => args[1] === "upload")).toEqual([
    "screenshots",
    "upload",
    "--version-localization",
    "locale-id",
    "--path",
    "apps/mac/assets/screenshots/en-US",
    "--device-type",
    "APP_DESKTOP",
    "--replace",
    "--confirm",
    "--output",
    "json",
  ]);
  expect(
    calls.filter((args) => args[0] === "screenshots" && args[1] === "list")
  ).toHaveLength(2);
});

test("publishes the iPhone set to its own display type", () => {
  const { result, calls } = run(false, false, false, false, "iphone");
  expect(result.exitCode).toBe(0);
  expect(calls[0]).toEqual([
    "screenshots",
    "validate",
    "--path",
    "apps/mobile/store/apple/screenshot/en-US/APP_IPHONE_67",
    "--device-type",
    "APP_IPHONE_67",
    "--output",
    "json",
  ]);
  const upload = calls.find((args) => args[1] === "upload");
  expect(upload?.slice(4, 8)).toEqual([
    "--path",
    "apps/mobile/store/apple/screenshot/en-US/APP_IPHONE_67",
    "--device-type",
    "APP_IPHONE_67",
  ]);
});

test("invalid local screenshots never replace the existing set", () => {
  const { result, calls } = run(false, true);
  expect(result.exitCode).not.toBe(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[1]).toBe("validate");
});

test("upload failure blocks release readiness", () => {
  const { result, calls } = run(false, false, true);
  expect(result.exitCode).not.toBe(0);
  expect(
    calls.filter((args) => args[0] === "screenshots" && args[1] === "list")
  ).toHaveLength(1);
});

test("Apple asset failure blocks readiness even when checksums match", () => {
  const { result, calls } = run(true, false, false, true);
  expect(result.exitCode).not.toBe(0);
  expect(calls.some((args) => args[1] === "upload")).toBe(true);
  expect(result.stderr.toString()).toContain(
    "Apple rejected a Mac screenshot asset"
  );
});
