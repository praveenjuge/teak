import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  desktopEnvTemplate,
  ensureDerivedEnv,
  ensureFile,
  ensureWebEnv,
  extensionEnvTemplate,
  mobileEnvTemplate,
  webEnvTemplate,
} from "./setup-derived-env.ts";

describe("webEnvTemplate", () => {
  test("contains the local Convex URLs", () => {
    const template = webEnvTemplate();
    expect(template).toContain("NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210");
    expect(template).toContain(
      "NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211"
    );
  });

  test("accepts derived overrides", () => {
    const template = webEnvTemplate({
      convexUrl: "https://cloud.example",
      convexSiteUrl: "https://site.example",
    });
    expect(template).toContain("NEXT_PUBLIC_CONVEX_URL=https://cloud.example");
    expect(template).toContain(
      "NEXT_PUBLIC_CONVEX_SITE_URL=https://site.example"
    );
  });
});

describe("framework templates", () => {
  const values = {
    convexUrl: "https://cloud.example",
    convexSiteUrl: "https://site.example",
    webUrl: "http://localhost:3000",
  };

  test("desktop template carries vite aliases and the web origin", () => {
    const template = desktopEnvTemplate(values);
    expect(template).toContain("VITE_PUBLIC_CONVEX_URL=https://cloud.example");
    expect(template).toContain(
      "VITE_PUBLIC_CONVEX_SITE_URL=https://site.example"
    );
    expect(template).toContain("VITE_WEB_URL=http://localhost:3000");
  });

  test("extension template carries vite aliases", () => {
    const template = extensionEnvTemplate(values);
    expect(template).toContain("VITE_PUBLIC_CONVEX_URL=https://cloud.example");
    expect(template).toContain(
      "VITE_PUBLIC_CONVEX_SITE_URL=https://site.example"
    );
  });

  test("mobile template carries expo aliases", () => {
    const template = mobileEnvTemplate(values);
    expect(template).toContain("EXPO_PUBLIC_CONVEX_URL=https://cloud.example");
    expect(template).toContain(
      "EXPO_PUBLIC_CONVEX_SITE_URL=https://site.example"
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

describe("ensureDerivedEnv", () => {
  test("repairs missing keys without overwriting existing values", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-setup-"));
    const path = join(dir, ".env.local");
    writeFileSync(path, "NEXT_PUBLIC_CONVEX_URL=http://custom\n");
    expect(ensureWebEnv(path)).toBe("repaired");
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("NEXT_PUBLIC_CONVEX_URL=http://custom");
    expect(content).toContain(
      "NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211"
    );
  });

  test("repair keeps custom values and fills derived gaps", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-setup-"));
    const path = join(dir, ".env.local");
    writeFileSync(path, "NEXT_PUBLIC_CONVEX_URL=http://custom\n");
    expect(
      ensureWebEnv(path, {
        convexUrl: "https://c.example",
        convexSiteUrl: "https://s.example",
      })
    ).toBe("repaired");
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("NEXT_PUBLIC_CONVEX_URL=http://custom");
    expect(content).toContain("NEXT_PUBLIC_CONVEX_SITE_URL=https://s.example");
  });

  test("generic entries create and repair any derived file", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-setup-"));
    const path = join(dir, ".env.local");
    expect(
      ensureDerivedEnv(path, { VITE_PUBLIC_CONVEX_URL: "https://c.example" })
    ).toBe("created");
    expect(
      ensureDerivedEnv(path, {
        VITE_PUBLIC_CONVEX_URL: "https://other.example",
        VITE_WEB_URL: "http://localhost:3000",
      })
    ).toBe("repaired");
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("VITE_PUBLIC_CONVEX_URL=https://c.example");
    expect(content).toContain("VITE_WEB_URL=http://localhost:3000");
  });
});
