import { describe, expect, test } from "bun:test";
import {
  expandEnvReferences,
  formatEnvIssues,
  validateWebEnvContent,
} from "./validate-env.ts";

const convexInputs =
  "NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210\nNEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211\n";
const webAuthInputs =
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3142/callback\nWORKOS_COOKIE_PASSWORD=test-session-password-for-fixtures-only\n";
const credentials =
  "WORKOS_CLIENT_ID=client_dev123\nWORKOS_API_KEY=sk_test_fixture\n";
const authInputs = webAuthInputs + credentials;

describe("validateWebEnvContent", () => {
  test("empty when local Convex URLs and WorkOS inputs are present and valid", () => {
    expect(validateWebEnvContent(convexInputs + authInputs, {})).toEqual([]);
  });

  test("reports missing keys with setup hint", () => {
    const issues = validateWebEnvContent(
      `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210\n${authInputs}`,
      {}
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.key).toBe("NEXT_PUBLIC_CONVEX_SITE_URL");
    expect(issues[0]?.problem).toBe("missing");
    expect(issues[0]?.hint).toContain("bun run setup");
  });

  test("flags non-URL values", () => {
    const issues = validateWebEnvContent(
      `NEXT_PUBLIC_CONVEX_URL=not-a-url\nNEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211\n${authInputs}`,
      {}
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.problem).toBe("invalid-url");
  });

  test("formatEnvIssues renders actionable lines", () => {
    const text = formatEnvIssues(
      validateWebEnvContent(`NEXT_PUBLIC_CONVEX_URL=\n${authInputs}`, {})
    );
    expect(text).toContain("NEXT_PUBLIC_CONVEX_URL");
    expect(text).toContain("bun run setup");
  });

  test("expands $VARIABLE references before URL validation", () => {
    const content = [
      "CONVEX_URL=http://127.0.0.1:3210",
      "CONVEX_SITE_URL=http://127.0.0.1:3211",
      "NEXT_PUBLIC_CONVEX_URL=$CONVEX_URL",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional dotenv fixture, not a template
      "NEXT_PUBLIC_CONVEX_SITE_URL=${CONVEX_SITE_URL}",
      authInputs,
    ].join("\n");
    expect(validateWebEnvContent(content, {})).toEqual([]);
  });

  test("expandEnvReferences keeps escaped dollars literal", () => {
    expect(expandEnvReferences("a/\\$b", () => "X")).toBe("a/$b");
  });
});

describe("AuthKit readiness", () => {
  test("names each missing WorkOS credential with a setup hint", () => {
    const issues = validateWebEnvContent(convexInputs + webAuthInputs, {});
    expect(issues.map((issue) => [issue.key, issue.problem])).toEqual([
      ["WORKOS_CLIENT_ID", "missing"],
      ["WORKOS_API_KEY", "missing"],
    ]);
    expect(issues[0]?.hint).toContain("bun run setup");
  });

  test("accepts credentials exported in the shell", () => {
    expect(
      validateWebEnvContent(convexInputs + webAuthInputs, {
        WORKOS_CLIENT_ID: "client_dev123",
        WORKOS_API_KEY: "sk_test_fixture",
      })
    ).toEqual([]);
  });

  test("rejects a short cookie password and never prints credential values", () => {
    const issues = validateWebEnvContent(
      `${convexInputs}NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3142/callback\nWORKOS_CLIENT_ID=client_dev123\nWORKOS_API_KEY=private-test-value\nWORKOS_COOKIE_PASSWORD=short\n`,
      {}
    );
    expect(issues.map((issue) => issue.problem)).toEqual([
      "invalid-auth-config",
    ]);
    expect(JSON.stringify(issues)).not.toContain("private-test-value");
  });
});
