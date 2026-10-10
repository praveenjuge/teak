import { expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.resolve(
  import.meta.dir,
  "../scripts/apply-store-metadata.sh"
);
const config = JSON.parse(
  readFileSync(path.resolve(import.meta.dir, "../store.config.json"), "utf8")
);

function run(editableCount = 1, mismatch = false, updateFails = false) {
  const root = mkdtempSync(path.join(tmpdir(), "teak-store-metadata-"));
  mkdirSync(path.join(root, "apps/mac"), { recursive: true });
  mkdirSync(path.join(root, "scripts/store-assets"), { recursive: true });
  mkdirSync(path.join(root, "bin"));
  writeFileSync(
    path.join(root, "apps/mac/store.config.json"),
    JSON.stringify(config)
  );
  writeFileSync(
    path.join(root, "scripts/store-assets/publish-apple.sh"),
    'test "$1" = mac && test "$2" = version-id\necho screenshots >> calls\n'
  );
  const asc = path.join(root, "bin/asc");
  writeFileSync(
    asc,
    `#!/usr/bin/env bun
import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync("calls", JSON.stringify(args) + "\\n");
const config = JSON.parse(fs.readFileSync("apps/mac/store.config.json"));
if (args[0] === "apps") {
  console.log(JSON.stringify({data:[{id:"live",attributes:{state:"READY_FOR_DISTRIBUTION"}}, ...Array.from({length:${editableCount}}, (_,i)=>({id:"editable-"+i,attributes:{state:"PREPARE_FOR_SUBMISSION"}}))]}));
} else if (args[1] === "update") {
  if (${updateFails}) process.exit(1);
  console.log("{}");
} else {
  const info = args.includes("--app-info");
  const attributes = {...(info ? config.appInfo : config.version), locale: config.locale};
  if (${mismatch}) attributes[info ? "name" : "description"] = "wrong";
  console.log(JSON.stringify({data:[{attributes}]}));
}
`
  );
  chmodSync(asc, 0o755);
  const result = Bun.spawnSync(["bash", script, "app-id", "version-id"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
      RUNNER_TEMP: root,
      GITHUB_STEP_SUMMARY: path.join(root, "summary"),
    },
  });
  return { result, calls: readFileSync(path.join(root, "calls"), "utf8") };
}

test("updates the editable app information and exact version, then verifies before screenshots", () => {
  const { result, calls } = run();
  expect(result.exitCode).toBe(0);
  const commands = calls.trim().split("\n");
  expect(JSON.parse(commands[1]!)).toEqual(
    expect.arrayContaining([
      "--app-info",
      "editable-0",
      "--name",
      config.appInfo.name,
    ])
  );
  expect(JSON.parse(commands[2]!)).toEqual(
    expect.arrayContaining([
      "--version",
      "version-id",
      "--description",
      config.version.description,
    ])
  );
  expect(commands.at(-1)).toBe("screenshots");
});

for (const count of [0, 2]) {
  test(`rejects ${count} editable app information records before mutation`, () => {
    const { result, calls } = run(count);
    expect(result.exitCode).not.toBe(0);
    expect(calls).not.toContain('"update"');
    expect(calls).not.toContain("screenshots");
  });
}

test("listing verification mismatch prevents screenshot publication", () => {
  const { result, calls } = run(1, true);
  expect(result.exitCode).not.toBe(0);
  expect(calls).not.toContain("screenshots");
});

test("failed metadata update prevents verification and screenshot publication", () => {
  const { result, calls } = run(1, false, true);
  expect(result.exitCode).not.toBe(0);
  expect(calls).not.toContain("screenshots");
  expect(calls.match(/"localizations","list"/g)).toBeNull();
});
