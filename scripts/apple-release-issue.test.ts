import { describe, expect, test } from "bun:test";
import {
  exactIssue,
  isLiveState,
  isStorefrontLive,
  issueTitle,
  openReleaseVersions,
  releaseDashboard,
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
    expect(isLiveState("PROCESSING_FOR_DISTRIBUTION")).toBe(false);
    expect(isLiveState("WAITING_FOR_REVIEW")).toBe(false);
    expect(isLiveState("REJECTED")).toBe(false);
    expect(isStorefrontLive("READY_FOR_DISTRIBUTION", "1.0.61", "1.0.61")).toBe(
      true
    );
    expect(isStorefrontLive("READY_FOR_DISTRIBUTION", "1.0.60", "1.0.61")).toBe(
      false
    );
  });

  test("enumerates every exact open release issue", () => {
    expect(
      openReleaseVersions([
        { title: "Apple release v1.0.61", state: "OPEN" },
        { title: "Apple release v1.0.59", state: "CLOSED" },
        { title: "Apple release v1.0.60", state: "OPEN" },
        { title: "Apple release v1.0.61 notes", state: "OPEN" },
      ])
    ).toEqual(["1.0.60", "1.0.61"]);
  });

  test("updates one dashboard and reports only state transitions", () => {
    const values = {
      "ios-state": "WAITING_FOR_REVIEW",
      "ios-store-version": "1.0.58",
      "safari-state": "WAITING_FOR_REVIEW",
      "safari-store-version": "1.0.59",
      "workflow-url": "https://github.com/praveenjuge/teak/actions/runs/1",
    };
    const first = releaseDashboard("Existing diagnostics.", values);
    const second = releaseDashboard(first.body, values);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.body.match(/Current release status/g)).toHaveLength(1);
    expect(second.body).toContain("Public storefront");
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
