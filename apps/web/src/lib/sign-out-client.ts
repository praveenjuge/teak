import { clearLocaleCookie } from "./locale";
import { resetPostHogUser } from "./posthog-client";
import { signOutWorkos } from "./sign-out";

export async function signOut() {
  resetPostHogUser();
  // The next account on this browser starts from its own language.
  clearLocaleCookie();
  const { url } = await signOutWorkos();
  window.location.assign(url);
}
