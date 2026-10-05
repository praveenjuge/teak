import { isLocalDevelopmentHostname } from "@teak/convex/dev-urls";
import type { PublicAuthMode } from "./auth-mode";

export function readWorkosWebConfig(
  mode: PublicAuthMode,
  environment: NodeJS.ProcessEnv = process.env
) {
  const clientId = environment.WORKOS_CLIENT_ID;
  const rawRedirect = environment.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
  const cookiePassword = environment.WORKOS_COOKIE_PASSWORD;
  if (
    mode.primary !== "workos" ||
    !clientId ||
    clientId !== mode.authKitClientId ||
    !/^client_[A-Za-z0-9]+$/.test(clientId) ||
    !environment.WORKOS_API_KEY ||
    !cookiePassword ||
    cookiePassword.length < 32 ||
    !rawRedirect
  ) {
    throw new Error("Sign-in is not configured for this environment.");
  }
  let redirect: URL;
  try {
    redirect = new URL(rawRedirect);
  } catch {
    throw new Error("Invalid sign-in callback configuration.");
  }
  const local = isLocalDevelopmentHostname(redirect.hostname);
  if (
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    redirect.pathname !== "/callback" ||
    (redirect.protocol !== "https:" &&
      !(
        environment.NODE_ENV !== "production" &&
        local &&
        redirect.protocol === "http:"
      ))
  ) {
    throw new Error("Invalid sign-in callback configuration.");
  }
  const issuer = `https://api.workos.com/user_management/${clientId}`;
  if (environment.WORKOS_ISSUER && environment.WORKOS_ISSUER !== issuer) {
    throw new Error("Sign-in issuer does not match this environment.");
  }
  return {
    clientId,
    origin: redirect.origin,
    redirectUri: redirect.toString(),
  };
}
