import { captureClientException } from "@teak/convex/shared/clientTelemetry";

/**
 * Deletes the account, then signs out. Once the deletion has happened a
 * failed sign-out mustn't read as a failed deletion (inviting a retry of
 * something already done), so it leaves through the sign-in page instead.
 */
export async function deleteAccountAndLeave({
  deleteAccount,
  leave,
  onDeleted,
  signOut: signOutNow,
}: {
  deleteAccount: () => Promise<unknown>;
  leave: () => void;
  onDeleted: () => void;
  signOut: () => Promise<void>;
}): Promise<void> {
  await deleteAccount();
  onDeleted();
  try {
    await signOutNow();
  } catch (error) {
    captureClientException(error, { operation: "account.delete.sign_out" });
    leave();
  }
}
