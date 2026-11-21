import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildContentSecurityPolicy,
  staticSecurityHeaders,
} from "../security-headers";

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
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("base-uri 'self'");
    expect(contentSecurityPolicy).toContain("media-src 'self' blob: data:");
    expect(directiveTokens("img-src")).toContain(teakR2StorageOrigin);
    expect(directiveTokens("img-src")).toContain("https://www.google.com");
    expect(directiveTokens("img-src")).toContain("https://*.gstatic.com");
    expect(directiveTokens("img-src")).not.toContain("https:");
    expect(directiveTokens("script-src")).toContain("'self'");
    for (const directive of ["script-src", "connect-src"]) {
      expect(
        directiveTokens(directive).filter((token) =>
          /posthog|ingest|vercel/u.test(token)
        )
      ).toEqual([]);
    }
    expect(directiveTokens("worker-src")).toContain("blob:");
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
    expect(directiveTokens("frame-src")).not.toContain("https://polar.sh");
    expect(directiveTokens("frame-src")).not.toContain("https://*.polar.sh");
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

  test("allows self-hosted file origins from build-time configuration", () => {
    const names = ["VITE_PUBLIC_FILES_BASE"];
    const previous = new Map(
      names.map((name) => [name, process.env[name]] as const)
    );
    process.env.VITE_PUBLIC_FILES_BASE = "https://files.example.com/worker";
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
    const previous = process.env.VITE_PUBLIC_FILES_BASE;
    process.env.VITE_PUBLIC_FILES_BASE = "http://files.example.com";
    try {
      const policy = buildContentSecurityPolicy("production");
      expect(policy).not.toContain("files.example.com");
    } finally {
      if (previous === undefined) {
        delete process.env.VITE_PUBLIC_FILES_BASE;
      } else {
        process.env.VITE_PUBLIC_FILES_BASE = previous;
      }
    }
  });

  test("upgrades insecure requests everywhere except development and test", () => {
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

  test("runs inline scripts only with the request's nonce, and eval only in development", () => {
    const scriptTokens = (
      environment: "development" | "production",
      nonce?: string
    ) =>
      buildContentSecurityPolicy(environment, nonce)
        .split("; ")
        .find((directive) => directive.startsWith("script-src "))
        ?.split(" ")
        .slice(1) ?? [];

    expect(scriptTokens("production", "abc123")).toContain("'nonce-abc123'");
    expect(scriptTokens("development", "abc123")).toContain("'nonce-abc123'");
    for (const environment of ["development", "production"] as const) {
      expect(scriptTokens(environment, "abc123")).not.toContain(
        "'unsafe-inline'"
      );
    }
    expect(scriptTokens("development")).toContain("'unsafe-eval'");
    expect(scriptTokens("production")).not.toContain("'unsafe-eval'");
  });

  test("keeps baseline browser security headers enabled", () => {
    // The CSP carries each request's nonce, so withSecurityHeaders adds it.
    expect(
      staticSecurityHeaders.some(({ key }) => key === "Content-Security-Policy")
    ).toBe(false);
    expect(headers.get("Strict-Transport-Security")).toContain(
      "includeSubDomains"
    );
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Permissions-Policy")).toContain("microphone=(self)");
    // WebMCP's `tools` keeps its default (self); naming it makes Chromium
    // without the origin trial log an error on every page.
    expect(headers.get("Permissions-Policy")).not.toContain("tools=");
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
    const previousConvex = process.env.VITE_PUBLIC_CONVEX_URL;
    const previousFiles = process.env.VITE_PUBLIC_FILES_BASE;
    process.env.VITE_PUBLIC_CONVEX_URL = convexUrl;
    if (filesBase === undefined) {
      delete process.env.VITE_PUBLIC_FILES_BASE;
    } else {
      process.env.VITE_PUBLIC_FILES_BASE = filesBase;
    }
    try {
      return buildContentSecurityPolicy(environment);
    } finally {
      if (previousConvex === undefined) {
        delete process.env.VITE_PUBLIC_CONVEX_URL;
      } else {
        process.env.VITE_PUBLIC_CONVEX_URL = previousConvex;
      }
      if (previousFiles === undefined) {
        delete process.env.VITE_PUBLIC_FILES_BASE;
      } else {
        process.env.VITE_PUBLIC_FILES_BASE = previousFiles;
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
      expect(connect.split(" ")).not.toContain("http:");
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
  const devFilesOrigin = "https://core-worker-dev.praveenjuge.workers.dev";
  const fileDirectives = ["img-src", "connect-src", "media-src", "frame-src"];
  const directive = (policy: string, name: string) =>
    policy
      .split("; ")
      .find((d) => d.startsWith(`${name} `))!
      .split(" ");

  test.each(["production", "development"] as const)(
    "a %s build for the dev deployment loads its isolated Core Worker",
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
  ])("other backends never allow the dev Core Worker: %s", (convexUrl) => {
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

test("static files carry the same headers as pages", () => {
  const rules = readFileSync(
    new URL("../../../public/_headers", import.meta.url),
    "utf8"
  );
  const allFiles = rules.split(/^\/\*$/m)[1]?.split(/^\S/m)[0] ?? "";
  const declared = allFiles
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(": "));
  expect(declared.length).toBeGreaterThan(0);
  for (const line of declared) {
    const [key, ...value] = line.split(": ");
    expect(headers.get(key ?? "")).toBe(value.join(": "));
  }
});
