import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
  };

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
    // biome-ignore lint/suspicious/noBitwiseOperators: POSIX file permission bits.
    expect(statSync(path).mode & 0o777).toBe(0o600);
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
        VITE_PUBLIC_CONVEX_SITE_URL: "https://s.example",
      })
    ).toBe("repaired");
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("VITE_PUBLIC_CONVEX_URL=https://c.example");
    expect(content).toContain("VITE_PUBLIC_CONVEX_SITE_URL=https://s.example");
  });
});

describe("local AuthKit environment writer", () => {
  test("derives callback from the worktree origin and keeps one session seal across repairs", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-authkit-"));
    const path = join(dir, ".env.local");
    expect(ensureWebEnv(path, { siteUrl: "http://localhost:3142" })).toBe(
      "created"
    );
    const first = readFileSync(path, "utf-8");
    // biome-ignore lint/suspicious/noBitwiseOperators: POSIX permissions exclude the file type bits.
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(first).toContain(
      "NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3142/callback"
    );
    const seal = first
      .split("\n")
      .find((line) => line.startsWith("WORKOS_COOKIE_PASSWORD="))
      ?.split("=")[1];
    expect(seal?.length).toBeGreaterThanOrEqual(32);
    expect(ensureWebEnv(path, { siteUrl: "http://localhost:3142" })).toBe(
      "exists"
    );
    expect(readFileSync(path, "utf-8")).toBe(first);
    writeFileSync(
      path,
      "WORKOS_COOKIE_PASSWORD=human-set-password-preserved\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3999/callback\n"
    );
    expect(ensureWebEnv(path, { siteUrl: "http://localhost:3142" })).toBe(
      "repaired"
    );
    const repaired = readFileSync(path, "utf-8");
    expect(repaired).toContain(
      "WORKOS_COOKIE_PASSWORD=human-set-password-preserved"
    );
    expect(repaired).toContain(
      "NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3999/callback"
    );
  });

  test("adds missing WorkOS credentials without replacing a set client ID", () => {
    const dir = mkdtempSync(join(tmpdir(), "teak-authkit-"));
    const path = join(dir, ".env.local");
    writeFileSync(path, "WORKOS_CLIENT_ID=client_human\n");
    expect(
      ensureWebEnv(path, {
        workos: {
          WORKOS_CLIENT_ID: "client_synced",
          WORKOS_API_KEY: "sk_test_synced",
        },
      })
    ).toBe("repaired");
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("WORKOS_CLIENT_ID=client_human");
    expect(content).not.toContain("client_synced");
    expect(content).toContain("WORKOS_API_KEY=sk_test_synced");
    // biome-ignore lint/suspicious/noBitwiseOperators: POSIX permissions exclude the file type bits.
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
