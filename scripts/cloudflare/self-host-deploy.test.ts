import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  API_ROUTE_PATHS,
  parseEnvFile,
  planSelfHostDeploy,
  SELF_HOST_DIR,
  SELF_HOST_KEYS,
  selfHostDeployArgs,
} from "./self-host-deploy";

const REQUIRED = {
  CONVEX_SITE_URLS: "https://happy-otter-123.convex.site",
  FILES_PUBLIC_ORIGIN: "https://files.example.com",
};

describe("parseEnvFile", () => {
  test("reads KEY=value lines, quotes, exports and comments", () => {
    expect(
      parseEnvFile(
        [
          "# comment",
          "",
          "A=one",
          "export B = two",
          'C="three # not a comment"',
          "D='four'",
          "E=five # trailing comment",
        ].join("\n")
      )
    ).toEqual({
      A: "one",
      B: "two",
      C: "three # not a comment",
      D: "four",
      E: "five",
    });
  });

  test("rejects a line that isn't KEY=value", () => {
    expect(() => parseEnvFile("A=1\nnot a pair")).toThrow("Line 2");
  });

  test("the committed example parses and names only known keys", () => {
    const example = readFileSync(join(SELF_HOST_DIR, "example.env"), "utf8");
    const values = parseEnvFile(example);
    for (const key of Object.keys(values)) {
      expect(SELF_HOST_KEYS).toContain(key);
    }
    const commented = [...example.matchAll(/^# ([A-Z_]+)=/gm)].map(
      (match) => match[1]
    );
    expect([...Object.keys(values), ...commented].sort()).toEqual(
      [...SELF_HOST_KEYS].sort()
    );
    expect(() => planSelfHostDeploy(values)).not.toThrow();
  });
});

describe("planSelfHostDeploy", () => {
  test("the minimum: Convex and a custom files domain", () => {
    expect(planSelfHostDeploy(REQUIRED)).toEqual({
      domains: ["files.example.com"],
      routes: [],
      vars: {
        CONVEX_SITE_URLS: "https://happy-otter-123.convex.site",
        FILES_PUBLIC_ORIGIN: "https://files.example.com",
      },
    });
  });

  test("a workers.dev files origin attaches no custom domain", () => {
    expect(
      planSelfHostDeploy({
        ...REQUIRED,
        FILES_PUBLIC_ORIGIN: "https://teak-core-worker.someone.workers.dev/",
      })
    ).toMatchObject({
      domains: [],
      vars: {
        FILES_PUBLIC_ORIGIN: "https://teak-core-worker.someone.workers.dev",
      },
    });
  });

  test("the API host adds the edge proxy's routes and defaults its upstream", () => {
    const plan = planSelfHostDeploy({
      ...REQUIRED,
      API_PUBLIC_HOST: "Example.com",
      API_WORKOS_ISSUER: "https://example.authkit.app",
    });
    expect(plan.routes).toEqual(API_ROUTE_PATHS.map((p) => `example.com${p}`));
    expect(plan.vars).toMatchObject({
      API_PUBLIC_HOST: "example.com",
      API_UPSTREAM_ORIGIN: "https://happy-otter-123.convex.site",
      API_WORKOS_ISSUER: "https://example.authkit.app",
    });
  });

  test("blank values count as unset and optional vars pass through", () => {
    const plan = planSelfHostDeploy({
      ...REQUIRED,
      API_PUBLIC_HOST: "  ",
      INBOUND_EMAIL_DOMAIN: "in.example.com",
      ANALYTICS_ACCOUNT_ID: "abc123",
      POSTHOG_PROJECT_TOKEN: "",
    });
    expect(plan.routes).toEqual([]);
    expect(plan.vars).toEqual({
      ...REQUIRED,
      INBOUND_EMAIL_DOMAIN: "in.example.com",
      ANALYTICS_ACCOUNT_ID: "abc123",
    });
  });

  test.each([
    [{ FILES_PUBLIC_ORIGIN: REQUIRED.FILES_PUBLIC_ORIGIN }, "CONVEX_SITE_URLS"],
    [
      { ...REQUIRED, TYPO_KEY: "x" },
      "Unknown keys in self-host/.env: TYPO_KEY",
    ],
    [
      { ...REQUIRED, CONVEX_SITE_URLS: "https://a.convex.site/path" },
      "CONVEX_SITE_URLS",
    ],
    [
      { ...REQUIRED, FILES_PUBLIC_ORIGIN: "http://files.example.com" },
      "FILES_PUBLIC_ORIGIN",
    ],
    [{ ...REQUIRED, API_PUBLIC_HOST: "example.com" }, "API_WORKOS_ISSUER"],
    [
      {
        ...REQUIRED,
        API_PUBLIC_HOST: "https://example.com",
        API_WORKOS_ISSUER: "https://a.authkit.app",
      },
      "API_PUBLIC_HOST",
    ],
    [
      { ...REQUIRED, API_WORKOS_ISSUER: "https://a.authkit.app" },
      "only with API_PUBLIC_HOST",
    ],
    [
      { ...REQUIRED, INBOUND_EMAIL_DOMAIN: "save@in.example.com" },
      "INBOUND_EMAIL_DOMAIN",
    ],
  ])("rejects %o", (values, message) => {
    expect(() => planSelfHostDeploy(values)).toThrow(message);
  });
});

test("selfHostDeployArgs deploys the self-host config with vars, domains, routes and secrets", () => {
  const plan = planSelfHostDeploy({
    ...REQUIRED,
    API_PUBLIC_HOST: "example.com",
    API_WORKOS_ISSUER: "https://example.authkit.app",
  });
  expect(
    selfHostDeployArgs(plan, {
      passthrough: ["--dry-run"],
      secretsFile: "self-host/.env.secrets",
    })
  ).toEqual([
    "deploy",
    "--config",
    "self-host/wrangler.jsonc",
    "--var",
    "CONVEX_SITE_URLS:https://happy-otter-123.convex.site",
    "--var",
    "FILES_PUBLIC_ORIGIN:https://files.example.com",
    "--var",
    "API_PUBLIC_HOST:example.com",
    "--var",
    "API_UPSTREAM_ORIGIN:https://happy-otter-123.convex.site",
    "--var",
    "API_WORKOS_ISSUER:https://example.authkit.app",
    "--domain",
    "files.example.com",
    ...API_ROUTE_PATHS.flatMap((path) => ["--route", `example.com${path}`]),
    "--secrets-file",
    "self-host/.env.secrets",
    "--dry-run",
  ]);
});

test("the edge proxy routes match the production config's", () => {
  const production = Bun.JSONC.parse(
    readFileSync(join(SELF_HOST_DIR, "../wrangler.jsonc"), "utf8")
  ) as { routes: { pattern: string; custom_domain?: boolean }[] };
  expect(
    production.routes
      .filter((route) => !route.custom_domain)
      .map((route) => route.pattern.replace(/^teakvault\.com/, ""))
  ).toEqual([...API_ROUTE_PATHS]);
});
