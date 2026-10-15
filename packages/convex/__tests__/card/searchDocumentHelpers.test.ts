import { describe, expect, test } from "bun:test";
import { isStaleTagSyncInvocation } from "../../card/searchDocumentHelpers";

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
