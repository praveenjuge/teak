import { unstable_rethrow } from "next/navigation";
import { clearLocaleCookie } from "./locale";
import { resetPostHogUser } from "./posthog-client";
import { signOutWorkos } from "./sign-out";

// The server action ends with redirect() to the WorkOS logout URL. Next.js
// follows it itself and also rejects the action's promise with its redirect
// signal, so that rejection means sign-out worked.
const isNextNavigation = (error: unknown) => {
  try {
    unstable_rethrow(error);
    return false;
  } catch {
    return true;
  }
};

export async function signOut() {
  resetPostHogUser();
  // The next account on this browser starts from its own language.
  clearLocaleCookie();
  try {
    await signOutWorkos();
  } catch (error) {
    if (!isNextNavigation(error)) {
      throw error;
    }
  }
}
