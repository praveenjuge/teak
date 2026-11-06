import { describe, expect, test } from "bun:test";
import {
  accountDeletionFailure,
  accountDeletionFailureCode,
  accountDeletionNeedsOperator,
  deletionFailureReason,
} from "../../accountDeletion/stages";

// The Core Worker records a stage failure under its reason. The reason
// reaches it three ways: the ConvexError a Convex step throws, the code the
// RPC gateway passes on for one, and, once a Workflow step gives up, the
// error's message alone.

class RpcError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

describe("deletionFailureReason", () => {
  test("reads the code a Convex step throws", () => {
    expect(
      deletionFailureReason(
        accountDeletionFailure("deletion_storage_source_changed")
      )
    ).toBe("storage_source_changed");
  });

  test("reads the code the RPC gateway passes on, detail and all", () => {
    expect(
      deletionFailureReason(
        new RpcError(
          "deletion_posthog_failed:status_502",
          "deletion_posthog_failed:status_502"
        )
      )
    ).toBe("analytics_deletion_failed");
  });

  test("reads the code from the message a finished Workflow step returns", () => {
    expect(
      deletionFailureReason(new Error("deletion_object_write_pending"))
    ).toBe("object_write_pending");
  });

  test.each([
    ["an error with no code", new Error("deletion_binding_changed")],
    [
      "a message that only starts like a code",
      new Error("deletion_posthog_unavailable"),
    ],
    [
      "a code that only appears later in the message",
      new Error("convex_rpc_unavailable:deletion_object_write_pending"),
    ],
    ["something that isn't an error", "deletion_object_write_pending"],
  ])("has no reason for %s", (_, error) => {
    expect(deletionFailureReason(error)).toBeUndefined();
  });
});

describe("accountDeletionNeedsOperator", () => {
  test("only a changed storage source waits for an operator", () => {
    expect(
      accountDeletionNeedsOperator(
        accountDeletionFailureCode(3, "storage_source_changed")
      )
    ).toBe(true);
    expect(
      accountDeletionNeedsOperator(
        accountDeletionFailureCode(3, "object_write_pending")
      )
    ).toBe(false);
    expect(accountDeletionNeedsOperator(accountDeletionFailureCode(0))).toBe(
      false
    );
    expect(accountDeletionNeedsOperator(undefined)).toBe(false);
  });
});
