import { describe, expect, test } from "bun:test";
import type { Doc } from "../../_generated/dataModel";
import {
  buildCardSearchText,
  isStaleTagSyncInvocation,
} from "../../card/searchSync";

describe("isStaleTagSyncInvocation", () => {
  test("runs an invocation scheduled for the current generation", () => {
    expect(isStaleTagSyncInvocation({ generation: 3 }, 3)).toBe(false);
  });

  test("runs an unfenced invocation, with or without a state row", () => {
    expect(isStaleTagSyncInvocation({ generation: 3 }, undefined)).toBe(false);
    expect(isStaleTagSyncInvocation(null, undefined)).toBe(false);
  });

  test("stops an invocation scheduled before the latest restart", () => {
    expect(isStaleTagSyncInvocation({ generation: 4 }, 3)).toBe(true);
  });

  test("stops a fenced invocation whose state row was pruned", () => {
    expect(isStaleTagSyncInvocation(null, 1)).toBe(true);
  });
});

describe("buildCardSearchText", () => {
  test("a [[…]] link is searchable by its title, not its id", () => {
    const text = buildCardSearchText({
      content:
        "Read [[Garden plan|teak:k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b]] first",
      notes: "Note",
      tags: ["home"],
    } as Doc<"cards">);
    expect(text).toBe("Read Garden plan first\nNote\nhome");
  });
});
