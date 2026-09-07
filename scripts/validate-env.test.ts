import { describe, expect, test } from "bun:test";
import { formatEnvIssues, validateWebEnvContent } from "./validate-env.ts";

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
});
