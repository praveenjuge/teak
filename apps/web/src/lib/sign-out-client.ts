import { unstable_rethrow } from "next/navigation";
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
  try {
    await signOutWorkos();
  } catch (error) {
    if (!isNextNavigation(error)) {
      throw error;
    }
  }
}
