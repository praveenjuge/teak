import { configure } from "@workos/authkit-session";
import { readWorkosWebConfig } from "@/lib/workos-config";

let configured: ReturnType<typeof readWorkosWebConfig> | undefined;

/**
 * Checks Teak's sign-in settings and hands them to AuthKit. AuthKit reads its
 * other settings (`WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, and the
 * emulator's `WORKOS_API_*` on the end-to-end stack) from the Worker's env;
 * the callback comes from `VITE_PUBLIC_WORKOS_REDIRECT_URI`, already checked
 * here. Throws when sign-in isn't configured.
 */
export function configureWorkos(): ReturnType<typeof readWorkosWebConfig> {
  if (configured) {
    return configured;
  }
  const config = readWorkosWebConfig();
  configure((key: string) =>
    key === "WORKOS_REDIRECT_URI" ? config.redirectUri : process.env[key]
  );
  configured = config;
  return config;
}
