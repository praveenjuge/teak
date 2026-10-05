import { describe, expect, test } from "bun:test";
import {
  expandEnvReferences,
  formatEnvIssues,
  validateWebEnvContent,
} from "./validate-env.ts";

describe("validateWebEnvContent", () => {
  test("empty when local Convex URLs are present and valid", () => {
    const content =
      "NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210\nNEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211\n";
    expect(validateWebEnvContent(content)).toEqual([]);
  });

  test("reports missing keys with setup hint", () => {
    const issues = validateWebEnvContent(
      "NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210\n"
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.key).toBe("NEXT_PUBLIC_CONVEX_SITE_URL");
    expect(issues[0]?.problem).toBe("missing");
    expect(issues[0]?.hint).toContain("bun run setup");
  });

  test("flags non-URL values", () => {
    const issues = validateWebEnvContent(
      "NEXT_PUBLIC_CONVEX_URL=not-a-url\nNEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211\n"
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.problem).toBe("invalid-url");
  });

  test("formatEnvIssues renders actionable lines", () => {
    const text = formatEnvIssues(
      validateWebEnvContent("NEXT_PUBLIC_CONVEX_URL=\n")
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
      "",
    ].join("\n");
    expect(validateWebEnvContent(content, {})).toEqual([]);
  });

  test("expandEnvReferences keeps escaped dollars literal", () => {
    expect(expandEnvReferences("a/\\$b", () => "X")).toBe("a/$b");
  });
});

describe("AuthKit readiness", () => {
  const publicInputs =
    "NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210\nNEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211\nNEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3142/callback\n";
  const credentials =
    "WORKOS_CLIENT_ID=client_dev123\nWORKOS_API_KEY=sk_test_fixture\nWORKOS_COOKIE_PASSWORD=test-session-password-for-fixtures-only\n";
  test("keeps Better Auth ready before WorkOS credentials are configured", () => {
    expect(
      validateWebEnvContent(
        `${publicInputs}WORKOS_COOKIE_PASSWORD=test-session-password-for-fixtures-only`,
        {}
      )
    ).toEqual([]);
  });
  test("accepts complete isolated development AuthKit inputs", () => {
    expect(validateWebEnvContent(publicInputs + credentials, {})).toEqual([]);
  });
  test("denies partial credentials and never prints the credential value", () => {
    const issues = validateWebEnvContent(
      `${publicInputs}WORKOS_API_KEY=private-test-value`,
      {}
    );
    expect(
      issues.some((issue) => issue.problem === "invalid-auth-config")
    ).toBe(true);
    expect(JSON.stringify(issues)).not.toContain("private-test-value");
  });
});
