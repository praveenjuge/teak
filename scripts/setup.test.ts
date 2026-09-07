import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkBunVersion,
  ensureFile,
  requiredBunVersion,
  webEnvTemplate,
} from "./setup.ts";

describe("requiredBunVersion", () => {
  test("parses the packageManager field", () => {
    expect(requiredBunVersion("bun@1.4.0")).toBe("1.4.0");
  });

  test("rejects unparseable values", () => {
    expect(() => requiredBunVersion("bun@latest")).toThrow();
  });
});

describe("checkBunVersion", () => {
  test("ok on exact match", () => {
    expect(checkBunVersion("1.4.0", "1.4.0")).toBe("ok");
  });

  test("warn on patch drift", () => {
    expect(checkBunVersion("1.4.1", "1.4.0")).toBe("warn");
  });

  test("mismatch on minor drift", () => {
    expect(checkBunVersion("1.5.0", "1.4.0")).toBe("mismatch");
  });
});

describe("webEnvTemplate", () => {
  test("contains the local Convex URLs", () => {
    const template = webEnvTemplate();
    expect(template).toContain("NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210");
    expect(template).toContain(
      "NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211"
    );
  });
});

describe("ensureFile", () => {
  test("creates missing files but never overwrites", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-setup-"));
    const path = join(dir, "nested", ".env.local");
    expect(ensureFile(path, "A=1\n")).toBe("created");
    expect(readFileSync(path, "utf-8")).toBe("A=1\n");
    expect(ensureFile(path, "B=2\n")).toBe("exists");
    expect(readFileSync(path, "utf-8")).toBe("A=1\n");
  });
});
