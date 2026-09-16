import { describe, expect, test } from "bun:test";
import {
  buildRelease,
  readAppVersion,
  resolveCommitShaFromEnv,
} from "./build-metadata.ts";

describe("build-metadata", () => {
  test("explicit GIT_SHA wins over provider metadata", () => {
    expect(
      resolveCommitShaFromEnv({
        GIT_SHA: "a".repeat(40),
        GITHUB_SHA: "b".repeat(40),
        VERCEL_GIT_COMMIT_SHA: "c".repeat(40),
      })
    ).toEqual({ sha: "a".repeat(40), source: "GIT_SHA" });
  });

  test("github precedes vercel metadata", () => {
    expect(
      resolveCommitShaFromEnv({
        GITHUB_SHA: "b".repeat(40),
        VERCEL_GIT_COMMIT_SHA: "c".repeat(40),
      })
    ).toEqual({ sha: "b".repeat(40), source: "GITHUB_SHA" });
    expect(
      resolveCommitShaFromEnv({ VERCEL_GIT_COMMIT_SHA: "c".repeat(40) })
    ).toEqual({ sha: "c".repeat(40), source: "VERCEL_GIT_COMMIT_SHA" });
  });

  test("empty env resolves nothing without git", () => {
    expect(resolveCommitShaFromEnv({})).toBeNull();
  });

  test("release names join prefix and sha", () => {
    expect(buildRelease("teak-backend", "abc123")).toBe("teak-backend@abc123");
  });

  test("app version matches the root manifest", () => {
    expect(readAppVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
