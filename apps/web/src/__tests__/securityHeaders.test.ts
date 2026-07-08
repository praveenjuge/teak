import { describe, expect, test } from "bun:test";
import {
  buildContentSecurityPolicy,
  securityHeaders,
  staticSecurityHeaders,
} from "../lib/security-headers";

const nonce = "test-nonce";
const contentSecurityPolicy = buildContentSecurityPolicy(nonce);

const headers = new Map(
  securityHeaders(nonce).map(({ key, value }) => [key, value] as const)
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
    expect(directiveTokens("script-src")).toContain("'nonce-test-nonce'");
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
    expect(directiveTokens("script-src")).not.toContain("'unsafe-inline'");
    expect(directiveTokens("script-src")).not.toContain("'unsafe-eval'");
    expect(directiveTokens("connect-src")).not.toContain("https:");
    expect(directiveTokens("connect-src")).not.toContain("wss:");
  });

  test("allows configured custom R2 origins only for document frames", () => {
    const previous = process.env.NEXT_PUBLIC_R2_PUBLIC_ORIGIN;
    process.env.NEXT_PUBLIC_R2_PUBLIC_ORIGIN =
      "https://files.teakvault.com/path, http://unsafe.example, not-a-url";
    try {
      const policy = buildContentSecurityPolicy(nonce);
      const tokens = (name: string) =>
        policy
          .split("; ")
          .find((directive) => directive.startsWith(`${name} `))
          ?.split(" ")
          .slice(1) ?? [];

      expect(tokens("frame-src")).toContain("https://files.teakvault.com");
      expect(tokens("frame-src")).not.toContain("http://unsafe.example");
      expect(tokens("img-src")).not.toContain("https://files.teakvault.com");
      expect(tokens("connect-src")).not.toContain(
        "https://files.teakvault.com"
      );
      expect(tokens("media-src")).not.toContain("https://files.teakvault.com");
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_R2_PUBLIC_ORIGIN;
      } else {
        process.env.NEXT_PUBLIC_R2_PUBLIC_ORIGIN = previous;
      }
    }
  });

  test("permits eval only in development for React/Next fast refresh", () => {
    const previous = process.env.NODE_ENV;
    const scriptTokens = () =>
      buildContentSecurityPolicy(nonce)
        .split("; ")
        .find((directive) => directive.startsWith("script-src "))
        ?.split(" ")
        .slice(1) ?? [];
    try {
      process.env.NODE_ENV = "development";
      expect(scriptTokens()).toContain("'unsafe-eval'");

      process.env.NODE_ENV = "production";
      expect(scriptTokens()).not.toContain("'unsafe-eval'");
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previous;
      }
    }
  });

  test("allows configured R2 storage origins for images, media, uploads and frames", () => {
    const previous = process.env.NEXT_PUBLIC_R2_STORAGE_ORIGIN;
    process.env.NEXT_PUBLIC_R2_STORAGE_ORIGIN =
      "https://teak-files-dev.example.r2.cloudflarestorage.com/path, http://unsafe.example, not-a-url";
    try {
      const policy = buildContentSecurityPolicy(nonce);
      const tokens = (name: string) =>
        policy
          .split("; ")
          .find((directive) => directive.startsWith(`${name} `))
          ?.split(" ")
          .slice(1) ?? [];

      const devStorageOrigin =
        "https://teak-files-dev.example.r2.cloudflarestorage.com";
      expect(tokens("img-src")).toContain(devStorageOrigin);
      expect(tokens("media-src")).toContain(devStorageOrigin);
      expect(tokens("connect-src")).toContain(devStorageOrigin);
      expect(tokens("frame-src")).toContain(devStorageOrigin);
      expect(tokens("img-src")).not.toContain("http://unsafe.example");
      // Exact origins only - never widened to a bare scheme or wildcard host.
      expect(tokens("img-src")).not.toContain("https:");
      expect(tokens("img-src")).not.toContain(
        "https://*.r2.cloudflarestorage.com"
      );
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_R2_STORAGE_ORIGIN;
      } else {
        process.env.NEXT_PUBLIC_R2_STORAGE_ORIGIN = previous;
      }
    }
  });

  test("allows configured R2 upload origins only for browser uploads", () => {
    const previous = process.env.R2_ENDPOINT;
    process.env.R2_ENDPOINT =
      "https://uploads.teakvault.example/path, http://unsafe.example, not-a-url";
    try {
      const policy = buildContentSecurityPolicy(nonce);
      const tokens = (name: string) =>
        policy
          .split("; ")
          .find((directive) => directive.startsWith(`${name} `))
          ?.split(" ")
          .slice(1) ?? [];

      expect(tokens("connect-src")).toContain(
        "https://uploads.teakvault.example"
      );
      expect(tokens("connect-src")).not.toContain("http://unsafe.example");
      expect(tokens("img-src")).not.toContain(
        "https://uploads.teakvault.example"
      );
      expect(tokens("frame-src")).not.toContain(
        "https://uploads.teakvault.example"
      );
    } finally {
      if (previous === undefined) {
        delete process.env.R2_ENDPOINT;
      } else {
        process.env.R2_ENDPOINT = previous;
      }
    }
  });

  test("keeps baseline browser security headers enabled", () => {
    expect(
      staticSecurityHeaders.some(({ key }) => key === "Content-Security-Policy")
    ).toBe(false);
    expect(headers.get("Strict-Transport-Security")).toContain(
      "includeSubDomains"
    );
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Permissions-Policy")).toContain("microphone=(self)");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });
});
