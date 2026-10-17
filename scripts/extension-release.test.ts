import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const workflow = fs.readFileSync(
  path.resolve(import.meta.dir, "../.github/workflows/extension-release.yml"),
  "utf8"
);
const firefox = workflow.slice(workflow.indexOf("\n  firefox:\n"));
const expression = (value: string) => `\${{ ${value} }}`;
const shellVariable = (name: string) => `\${${name}}`;

describe("Extension Release for Firefox", () => {
  test("skips a version whose Firefox zip is already released", () => {
    expect(firefox).toContain(
      `expected_asset="teak-extension-${shellVariable("version")}-firefox.zip"`
    );
  });

  test("submits every listed version to AMO with its versioned sources", () => {
    expect(firefox).toContain(
      `sources_zip="teak-extension-${shellVariable("version")}-sources.zip"`
    );
    expect(firefox).toContain("--channel=listed");
    expect(firefox).toContain('--upload-source-code "$SOURCES_ZIP"');
    expect(firefox).toContain(
      `SOURCES_ZIP: ${expression("steps.zip.outputs.sources_zip_path")}`
    );
  });

  test("keeps AMO credentials in secrets and the Firefox build free of telemetry", () => {
    expect(firefox).toContain(
      `WEB_EXT_API_KEY: ${expression("secrets.AMO_JWT_ISSUER")}`
    );
    expect(firefox).toContain(
      `WEB_EXT_API_SECRET: ${expression("secrets.AMO_JWT_SECRET")}`
    );
    expect(firefox).not.toContain("POSTHOG");
  });

  test("attaches the Firefox zip and its sources to the GitHub Release", () => {
    expect(firefox).toContain(
      'gh release upload "$TAG_NAME" "$RELEASE_ZIP" "$SOURCES_ZIP" --clobber'
    );
  });
});
