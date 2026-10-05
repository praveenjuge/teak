"use server";

import {
  getSignInUrl,
  getSignUpUrl,
  signOut,
} from "@workos-inc/authkit-nextjs";
import { readAuthMode } from "@/lib/auth-mode-server";
import { getSafeNextPath } from "@/lib/safe-next-path";
import { readWorkosWebConfig } from "@/lib/workos-config";

export async function startWorkosAuth(
  next: string | null,
  signup = false,
  recovery = false
) {
  const mode = await readAuthMode();
  const config = readWorkosWebConfig(mode);
  if (recovery && mode.accountChangesPaused) {
    return { error: "Account changes are paused. Please try again later." };
  }
  if (signup && mode.signupsDisabled) {
    return { error: "Signups are paused. You can still sign in." };
  }
  const options = {
    returnTo: getSafeNextPath(next) ?? "/",
    redirectUri: config.redirectUri,
    state: JSON.stringify({ primary: mode.primary, clientId: config.clientId }),
  };
  const url = signup
    ? await getSignUpUrl(options)
    : await getSignInUrl(options);
  return { url };
}

export async function signOutWorkos() {
  const mode = await readAuthMode();
  const { origin } = readWorkosWebConfig(mode);
  await signOut({ returnTo: `${origin}/login` });
}
