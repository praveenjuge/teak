import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import config from "../blume.config";

const docsRoot = path.join(import.meta.dir, "..");

describe("blume.config.ts", () => {
  test("marketing pages use the docs accent color", () => {
    const themeCss = readFileSync(path.join(docsRoot, "theme.css"), "utf8");
    expect(config.theme?.accent).toBe(
      themeCss.match(/--blume-accent:\s*([^;]+);/)?.[1]
    );
  });
});
