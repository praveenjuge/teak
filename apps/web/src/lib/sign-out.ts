"use server";

import { signOut } from "@workos-inc/authkit-nextjs";
import { cookies } from "next/headers";
import { signInUrl } from "@/lib/authUrls";
import { sessionHintCookie } from "@/lib/session-hint";
import { readWorkosWebConfig } from "@/lib/workos-config";

export async function signOutWorkos() {
  const { origin } = readWorkosWebConfig();
  (await cookies()).set(sessionHintCookie(origin, false));
  await signOut({ returnTo: signInUrl(origin).toString() });
}
