import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const convexRoot = resolve(import.meta.dirname, "../..");
const readConvexSource = (relativePath: string) =>
  readFileSync(resolve(convexRoot, relativePath), "utf8");

describe("backend telemetry Node runtime", () => {
  test("marks every Node-only AI telemetry helper", () => {
    for (const relativePath of [
      "ai/telemetry.ts",
      "workflows/aiMetadata/generators.ts",
      "workflows/aiMetadata/transcript.ts",
    ]) {
      expect(readConvexSource(relativePath).trimStart()).toStartWith(
        '"use node";'
      );
    }
  });

  test("keeps Node-only helpers out of the default-runtime workflow barrel", () => {
    const source = readConvexSource("workflows/aiMetadata/index.ts");

    expect(source).not.toContain('from "./generators"');
    expect(source).not.toContain('from "./transcript"');
  });
});
