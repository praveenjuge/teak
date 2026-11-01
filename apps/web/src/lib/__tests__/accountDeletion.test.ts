import { expect, mock, test } from "bun:test";

mock.module("@teak/convex/shared/clientTelemetry", () => ({
  captureClientException: mock(),
}));
const { deleteAccountAndLeave } = await import("../accountDeletion");

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
