"use server";

import { signOut } from "@workos-inc/authkit-nextjs";
import { readAuthMode } from "@/lib/auth-mode-server";
import { readWorkosWebConfig } from "@/lib/workos-config";

export async function signOutWorkos() {
  const mode = await readAuthMode();
  const { origin } = readWorkosWebConfig(mode);
  await signOut({ returnTo: `${origin}/login` });
}
