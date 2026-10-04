import {
  AuthRequest,
  CodeChallengeMethod,
  ResponseType,
} from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import type { WorkosSession } from "./workos-session";

const discovery = {
  authorizationEndpoint: "https://api.workos.com/user_management/authorize",
};
export const WORKOS_REDIRECT_URI = "teak://auth/callback";
WebBrowser.maybeCompleteAuthSession();

// Only the public client ID crosses the native boundary. Expo generates state
// and the S256 verifier/challenge; the system browser handles every provider.
export async function signInWithWorkos(
  session: WorkosSession,
  provider: "authkit" | "GoogleOAuth" | "AppleOAuth" = "authkit"
): Promise<boolean> {
  await session.hydrate();
  const attempt = session.beginSignIn();
  const request = new AuthRequest({
    clientId: session.clientId,
    redirectUri: WORKOS_REDIRECT_URI,
    responseType: ResponseType.Code,
    usePKCE: true,
    codeChallengeMethod: CodeChallengeMethod.S256,
    extraParams: { provider },
  });
  await request.makeAuthUrlAsync(discovery);
  const result = await request.promptAsync(discovery);
  if (result.type === "cancel" || result.type === "dismiss") {
    return false;
  }
  if (
    result.type !== "success" ||
    result.params.state !== request.state ||
    !result.params.code ||
    !request.codeVerifier
  ) {
    throw new Error("Unable to complete sign-in. Please try again.");
  }
  return (
    (await session.exchangeCode(
      result.params.code,
      request.codeVerifier,
      attempt
    )) !== null
  );
}

// Server revocation is performed by Teak's session action before this browser
// logout. Returning from a browser is not evidence that a session was revoked.
export async function openWorkosLogout(sessionId: string): Promise<void> {
  if (!/^session_[A-Za-z0-9]+$/.test(sessionId)) {
    throw new Error("Invalid session");
  }
  const url = new URL("https://api.workos.com/user_management/sessions/logout");
  url.searchParams.set("session_id", sessionId);
  await WebBrowser.openBrowserAsync(url.href);
}
