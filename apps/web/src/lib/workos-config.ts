import { isLocalDevelopmentHostname } from "@teak/convex/dev-urls";

export function readWorkosWebConfig(
  environment: NodeJS.ProcessEnv = process.env
) {
  const clientId = environment.WORKOS_CLIENT_ID;
  const rawRedirect = environment.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
  const cookiePassword = environment.WORKOS_COOKIE_PASSWORD;
  if (
    !(
      clientId &&
      /^client_[A-Za-z0-9]+$/.test(clientId) &&
      environment.WORKOS_API_KEY &&
      cookiePassword
    ) ||
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

// Sign-ins carry the client they started with in AuthKit's sealed state, so a
// callback can't complete against a different WorkOS client.
export function workosCallbackState(clientId: string): string {
  return JSON.stringify({ clientId });
}

export function assertWorkosCallbackBinding(
  state: string | undefined,
  clientId: string
): void {
  let binding: unknown = null;
  try {
    binding = state ? JSON.parse(state) : null;
  } catch {
    binding = null;
  }
  if (
    !binding ||
    typeof binding !== "object" ||
    !("clientId" in binding && binding.clientId === clientId)
  ) {
    throw new Error("Sign-in changed. Please start again.");
  }
}
