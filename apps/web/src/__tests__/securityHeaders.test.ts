import { describe, expect, test } from "bun:test";
import {
  buildContentSecurityPolicy,
  staticSecurityHeaders,
} from "../lib/security-headers";

// Ambient environment, matching what staticSecurityHeaders embeds; the policy
// is environment-dependent (unsafe-eval in development, http upgrades only in
// production), so the prod-shaped assertions below pin the non-varying parts.
const contentSecurityPolicy = buildContentSecurityPolicy();

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

  test("allows self-hosted file origins from build-time configuration", () => {
    const names = ["NEXT_PUBLIC_FILES_BASE"];
    const previous = new Map(
      names.map((name) => [name, process.env[name]] as const)
    );
    process.env.NEXT_PUBLIC_FILES_BASE = "https://files.example.com/worker";
    try {
      const policy = buildContentSecurityPolicy("production");
      const tokens = (name: string) =>
        policy
          .split("; ")
          .find((directive) => directive.startsWith(`${name} `))
          ?.split(" ")
          .slice(1) ?? [];
      for (const name of ["img-src", "connect-src", "media-src", "frame-src"]) {
        expect(tokens(name)).toContain("https://files.example.com");
      }
      expect(policy).toContain("https://files.teakvault.com");
    } finally {
      for (const name of names) {
        const value = previous.get(name);
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  test("ignores non-https file origins", () => {
    const previous = process.env.NEXT_PUBLIC_FILES_BASE;
    process.env.NEXT_PUBLIC_FILES_BASE = "http://files.example.com";
    try {
      const policy = buildContentSecurityPolicy("production");
      expect(policy).not.toContain("files.example.com");
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_FILES_BASE;
      } else {
        process.env.NEXT_PUBLIC_FILES_BASE = previous;
      }
    }
  });

  test("upgrades insecure requests everywhere except development and test", () => {
    // Development serves plain http://localhost; the upgrade directive makes
    // browsers request chunks over https:// and fail with connection errors.
    expect(buildContentSecurityPolicy("production")).toContain(
      "upgrade-insecure-requests"
    );
    expect(buildContentSecurityPolicy("development")).not.toContain(
      "upgrade-insecure-requests"
    );
    expect(buildContentSecurityPolicy("test")).not.toContain(
      "upgrade-insecure-requests"
    );
    expect(buildContentSecurityPolicy("staging")).toContain(
      "upgrade-insecure-requests"
    );
  });

  test("upgrades insecure requests when the environment is missing", () => {
    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      expect(buildContentSecurityPolicy()).toContain(
        "upgrade-insecure-requests"
      );
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previous;
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
    expect(headers.get("Permissions-Policy")).toContain("tools=(self)");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("configured local backend security policy", () => {
  const policyFor = (
    environment: "development" | "production" | "test",
    convexUrl: string,
    filesBase?: string
  ) => {
    const previousConvex = process.env.NEXT_PUBLIC_CONVEX_URL;
    const previousFiles = process.env.NEXT_PUBLIC_FILES_BASE;
    process.env.NEXT_PUBLIC_CONVEX_URL = convexUrl;
    if (filesBase === undefined) {
      delete process.env.NEXT_PUBLIC_FILES_BASE;
    } else {
      process.env.NEXT_PUBLIC_FILES_BASE = filesBase;
    }
    try {
      return buildContentSecurityPolicy(environment);
    } finally {
      if (previousConvex === undefined) {
        delete process.env.NEXT_PUBLIC_CONVEX_URL;
      } else {
        process.env.NEXT_PUBLIC_CONVEX_URL = previousConvex;
      }
      if (previousFiles === undefined) {
        delete process.env.NEXT_PUBLIC_FILES_BASE;
      } else {
        process.env.NEXT_PUBLIC_FILES_BASE = previousFiles;
      }
    }
  };
  test.each(
    (["development", "test"] as const).flatMap((environment) =>
      [
        "http://127.0.0.1:3210",
        "http://localhost:3210",
        "http://[::1]:3210",
      ].map((url) => ({ environment, url }))
    )
  )(
    "allows configured loopback HTTP and WebSocket in $environment: $url",
    ({ environment, url }) => {
      const policy = policyFor(environment, url, "http://127.0.0.1:8789");
      const connect = policy
        .split("; ")
        .find((d) => d.startsWith("connect-src "))!;
      expect(connect.split(" ")).toContain(url);
      expect(connect.split(" ")).toContain(url.replace("http:", "ws:"));
      for (const directive of [
        "img-src",
        "media-src",
        "connect-src",
        "frame-src",
      ]) {
        expect(
          policy
            .split("; ")
            .find((d) => d.startsWith(`${directive} `))!
            .split(" ")
        ).toContain("http://127.0.0.1:8789");
      }
      expect(connect.split(" ")).not.toContain("http:"); // no scheme-wide permission
    }
  );
  test.each(["production", undefined] as const)(
    "never admits insecure local origins in %s",
    (environment) => {
      const previous = process.env.NODE_ENV;
      if (environment === undefined) {
        delete process.env.NODE_ENV;
      }
      try {
        const policy = policyFor(
          environment as "production",
          "http://127.0.0.1:3210",
          "http://localhost:8789"
        );
        expect(policy).not.toContain("127.0.0.1:3210");
        expect(policy).not.toContain("localhost:8789");
        expect(policy).toContain("upgrade-insecure-requests");
      } finally {
        if (previous === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previous;
        }
      }
    }
  );
  test("rejects credential-bearing HTTPS origins in production", () => {
    const policy = policyFor(
      "production",
      "https://user:password@backend.example",
      "https://user:password@files.example"
    );
    expect(policy).not.toContain("https://backend.example");
    expect(policy).not.toContain("wss://backend.example");
    expect(policy).not.toContain("https://files.example");
  });
  test.each([
    "http://evil.example:3210",
    "http://localhost.evil.example:3210",
    "http://user:password@localhost:3210",
    "javascript:alert(1)",
  ])("rejects unsafe development origin %s", (url) => {
    const policy = policyFor("development", url, url);
    expect(policy).not.toContain(url);
    expect(policy).not.toContain(`${new URL(url).origin} `);
  });
  const devFilesOrigin =
    "https://teak-files-development.praveenjuge.workers.dev";
  const fileDirectives = ["img-src", "connect-src", "media-src", "frame-src"];
  const directive = (policy: string, name: string) =>
    policy
      .split("; ")
      .find((d) => d.startsWith(`${name} `))!
      .split(" ");

  test.each(["production", "development"] as const)(
    "a %s build for the dev deployment loads its isolated Files Worker",
    (environment) => {
      const policy = policyFor(
        environment,
        "https://reminiscent-kangaroo-59.convex.cloud"
      );
      for (const name of fileDirectives) {
        expect(directive(policy, name)).toContain(devFilesOrigin);
        expect(directive(policy, name)).not.toContain("https://*.workers.dev");
      }
    }
  );

  test.each([
    "https://uncommon-ladybug-882.convex.cloud",
    "https://reminiscent-kangaroo-59.convex.cloud.evil.example",
    "https://other-deployment-1.convex.cloud",
    "http://reminiscent-kangaroo-59.convex.cloud",
    "http://127.0.0.1:3210",
  ])("other backends never allow the dev Files Worker: %s", (convexUrl) => {
    for (const environment of ["production", "development"] as const) {
      const policy = policyFor(environment, convexUrl);
      expect(policy).not.toContain("workers.dev");
      for (const name of ["connect-src", "media-src", "frame-src"]) {
        expect(directive(policy, name)).toContain(
          "https://files.teakvault.com"
        );
      }
    }
  });
});
