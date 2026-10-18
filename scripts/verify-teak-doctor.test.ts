import { describe, expect, test } from "bun:test";
import {
  backendVerdict,
  latestPushFailed,
} from "../.agents/skills/verify-teak/scripts/doctor.ts";

const READY = "✔ 12:00:01 Convex functions ready! (2.1s)";
const FAILED = "✖ Schema validation failed.\nDocument with ID … in table cards";

describe("verify-teak doctor: latest push outcome", () => {
  test("a schema failure after the last successful push fails", () => {
    expect(latestPushFailed(`${READY}\n${FAILED}\n`)).toBe(true);
  });

  test("a schema failure fixed by a later push doesn't fail", () => {
    expect(latestPushFailed(`${READY}\n${FAILED}\n${READY}\n`)).toBe(false);
  });

  test("a log with only successful pushes, or none yet, doesn't fail", () => {
    expect(latestPushFailed(`${READY}\n`)).toBe(false);
    expect(latestPushFailed("starting convex dev\n")).toBe(false);
  });

  test("a failure before any successful push fails", () => {
    expect(latestPushFailed(`${FAILED}\n`)).toBe(true);
  });
});

describe("verify-teak doctor: backend verdict", () => {
  test("this checkout's live push of matching code is current", () => {
    expect(
      backendVerdict({ codeMatches: true, pushedBySelf: true, pushing: true })
    ).toBe("current");
  });

  test("an earlier push from this checkout that isn't syncing now is unverified", () => {
    expect(
      backendVerdict({ codeMatches: true, pushedBySelf: true, pushing: false })
    ).toBe("unverified");
  });

  test("another checkout's push at matching code is unverified", () => {
    expect(
      backendVerdict({ codeMatches: true, pushedBySelf: false, pushing: false })
    ).toBe("unverified");
  });

  test("different backend code differs, whoever pushed it", () => {
    expect(
      backendVerdict({ codeMatches: false, pushedBySelf: true, pushing: true })
    ).toBe("differs");
  });
});
