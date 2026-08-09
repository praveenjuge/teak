import { describe, expect, test } from "bun:test";
import {
  exactIssue,
  isLiveState,
  issueTitle,
  sanitizeAscOutput,
} from "./apple-release-issue.mjs";

describe("Apple release issue handling", () => {
  test("deduplicates only by the exact version title", () => {
    const issues = [
      { number: 1, title: "Apple release v1.0.6 follow-up" },
      { number: 2, title: "Apple release v1.0.60" },
      { number: 3, title: "Apple release v1.0.59" },
    ];
    expect(issueTitle("1.0.60")).toBe("Apple release v1.0.60");
    expect(exactIssue(issues, "1.0.60")?.number).toBe(2);
  });

  test("closes only after both platforms reach a live state", () => {
    expect(isLiveState("READY_FOR_DISTRIBUTION")).toBe(true);
    expect(isLiveState("READY_FOR_SALE")).toBe(true);
    expect(isLiveState("PROCESSING_FOR_DISTRIBUTION")).toBe(true);
    expect(isLiveState("WAITING_FOR_REVIEW")).toBe(false);
    expect(isLiveState("REJECTED")).toBe(false);
  });

  test("redacts credential-shaped asc output", () => {
    const output = sanitizeAscOutput(`state: REJECTED
token: abc123
-----BEGIN PRIVATE KEY-----
secret
-----END PRIVATE KEY-----`);
    expect(output).toContain("state: REJECTED");
    expect(output).not.toContain("abc123");
    expect(output).not.toContain("BEGIN PRIVATE KEY");
  });
});
