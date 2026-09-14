import { describe, expect, test } from "bun:test";
import {
  buildContentSecurityPolicy,
  staticSecurityHeaders,
} from "../lib/security-headers";

const contentSecurityPolicy = buildContentSecurityPolicy("production");

const headers = new Map(
  staticSecurityHeaders.map(({ key, value }) => [key, value] as const)
);
const teakR2StorageOrigin =
  "https://teak-files-prod.dd19e45b8f2f3cc0393cc2deb51fa27d.r2.cloudflarestorage.com";
const teakR2UploadOrigin =
  "https://dd19e45b8f2f3cc0393cc2deb51fa27d.r2.cloudflarestorage.com";
const directiveTokens = (name: string) =>
  contentSecurityPolicy
    .split("; ")
    .find((directive) => directive.startsWith(`${name} `))
    ?.split(" ")
    .slice(1) ?? [];

describe("web security headers", () => {
  test("ships a content security policy for authenticated and auth routes", () => {
    expect(headers.get("Content-Security-Policy")).toBe(contentSecurityPolicy);
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("base-uri 'self'");
    expect(contentSecurityPolicy).toContain("media-src 'self' blob: data:");
    expect(directiveTokens("img-src")).toContain(teakR2StorageOrigin);
    expect(directiveTokens("img-src")).toContain("https://www.google.com");
    expect(directiveTokens("img-src")).toContain("https://*.gstatic.com");
    expect(directiveTokens("img-src")).not.toContain("https:");
    expect(directiveTokens("script-src")).toContain("'self'");
    expect(directiveTokens("script-src")).toContain(
      "https://va.vercel-scripts.com"
    );
    expect(directiveTokens("script-src")).not.toContain("'strict-dynamic'");
    expect(
      directiveTokens("script-src").some((token) => token.startsWith("'nonce-"))
    ).toBe(false);
    expect(directiveTokens("connect-src")).toContain(teakR2StorageOrigin);
    expect(directiveTokens("connect-src")).toContain(teakR2UploadOrigin);
    expect(directiveTokens("media-src")).toContain(teakR2StorageOrigin);
    expect(directiveTokens("frame-src")).toContain(teakR2StorageOrigin);
    expect(directiveTokens("frame-src")).toContain(
      "https://*.r2.cloudflarestorage.com"
    );
    expect(directiveTokens("frame-src")).toContain("https://*.r2.dev");
    expect(directiveTokens("img-src")).not.toContain(
      "https://*.r2.cloudflarestorage.com"
    );
    expect(directiveTokens("img-src")).not.toContain("https://*.r2.dev");
    expect(directiveTokens("connect-src")).not.toContain(
      "https://*.r2.cloudflarestorage.com"
    );
    expect(directiveTokens("connect-src")).not.toContain("https://*.r2.dev");
    expect(directiveTokens("media-src")).not.toContain(
      "https://*.r2.cloudflarestorage.com"
    );
    expect(directiveTokens("media-src")).not.toContain("https://*.r2.dev");
    expect(directiveTokens("script-src")).not.toContain("https:");
    expect(directiveTokens("script-src")).toContain("'unsafe-inline'");
    expect(directiveTokens("script-src")).not.toContain("'unsafe-eval'");
    expect(directiveTokens("connect-src")).not.toContain("https:");
    expect(directiveTokens("connect-src")).not.toContain("wss:");
  });

  test("allows the worker-gated files origin for media, frames and fetches", () => {
    expect(directiveTokens("media-src")).toContain(
      "https://files.teakvault.com"
    );
    expect(directiveTokens("frame-src")).toContain(
      "https://files.teakvault.com"
    );
    expect(directiveTokens("connect-src")).toContain(
      "https://files.teakvault.com"
    );
  });

  test("ignores removed R2 origin aliases and keeps canonical file origins", () => {
    const aliases = [
      "NEXT_PUBLIC_R2_STORAGE_ORIGIN",
      "NEXT_PUBLIC_R2_STORAGE_URL",
      "R2_STORAGE_ORIGIN",
      "R2_STORAGE_URL",
      "NEXT_PUBLIC_R2_PUBLIC_ORIGIN",
      "NEXT_PUBLIC_R2_PUBLIC_URL",
      "R2_PUBLIC_ORIGIN",
      "R2_PUBLIC_URL",
      "NEXT_PUBLIC_R2_UPLOAD_ORIGIN",
      "NEXT_PUBLIC_R2_UPLOAD_URL",
      "R2_UPLOAD_ORIGIN",
      "R2_UPLOAD_URL",
    ];
    const previous = new Map(
      aliases.map((name) => [name, process.env[name]] as const)
    );
    for (const name of aliases) {
      process.env[name] = "https://cdn.example.com";
    }
    try {
      const policy = buildContentSecurityPolicy("production");
      expect(policy).not.toContain("https://cdn.example.com");
      expect(policy).toContain("https://files.teakvault.com");
      expect(policy).toContain(teakR2StorageOrigin);
    } finally {
      for (const name of aliases) {
        const value = previous.get(name);
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  test("allows framework bootstraps in production but eval only in development", () => {
    const scriptTokens = (environment: "development" | "production") =>
      buildContentSecurityPolicy(environment)
        .split("; ")
        .find((directive) => directive.startsWith("script-src "))
        ?.split(" ")
        .slice(1) ?? [];

    expect(scriptTokens("development")).toContain("'unsafe-eval'");
    expect(scriptTokens("development")).toContain("'unsafe-inline'");
    expect(scriptTokens("production")).not.toContain("'unsafe-eval'");
    expect(scriptTokens("production")).toContain("'unsafe-inline'");
  });

  test("keeps baseline browser security headers enabled", () => {
    expect(
      staticSecurityHeaders.some(({ key }) => key === "Content-Security-Policy")
    ).toBe(true);
    expect(headers.get("Strict-Transport-Security")).toContain(
      "includeSubDomains"
    );
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Permissions-Policy")).toContain("microphone=(self)");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });
});
