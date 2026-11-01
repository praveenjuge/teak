import { expect, mock, test } from "bun:test";

mock.module("@teak/convex/shared/clientTelemetry", () => ({
  captureClientException: mock(),
}));
const { deleteAccountAndLeave, LEAVE_AFTER_DELETION_URL } = await import(
  "../accountDeletion"
);
const { workosEntryRedirect } = await import("../auth-entry");

test("a sign-out that fails after the deletion leaves anyway, without reporting a failed deletion", async () => {
  const leave = mock();
  const onDeleted = mock();
  await expect(
    deleteAccountAndLeave({
      deleteAccount: () => Promise.resolve(null),
      leave,
      onDeleted,
      signOut: () => Promise.reject(new Error("network")),
    })
  ).resolves.toBeUndefined();
  expect(onDeleted).toHaveBeenCalledTimes(1);
  expect(leave).toHaveBeenCalledTimes(1);
});

test("a deletion that fails is reported, and nothing signs out", async () => {
  const signOut = mock(() => Promise.resolve());
  const onDeleted = mock();
  await expect(
    deleteAccountAndLeave({
      deleteAccount: () => Promise.reject(new Error("Server Error")),
      leave: mock(),
      onDeleted,
      signOut,
    })
  ).rejects.toThrow("Server Error");
  expect(onDeleted).not.toHaveBeenCalled();
  expect(signOut).not.toHaveBeenCalled();
});

test("leaving after a deletion isn't sent back into the app by a live session", () => {
  const url = new URL(LEAVE_AFTER_DELETION_URL, "http://localhost:3000");
  expect(workosEntryRedirect(url, true)).toBeNull();
  // Plain /sign-in would be.
  expect(
    workosEntryRedirect(new URL("/sign-in", "http://localhost:3000"), true)
  ).not.toBeNull();
});
