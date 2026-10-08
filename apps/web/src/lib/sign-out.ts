"use server";

import { signOut } from "@workos-inc/authkit-nextjs";
import { readWorkosWebConfig } from "@/lib/workos-config";

export async function signOutWorkos() {
  const { origin } = readWorkosWebConfig();
  await signOut({ returnTo: `${origin}/login` });
}
