import { api } from "@teak/convex";
import { SIGNUPS_PAUSED_MESSAGE } from "@teak/convex/shared/constants";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import {
  AuthRequest,
  CodeChallengeMethod,
  ResponseType,
} from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { getConvexUrl } from "./public-env";
import { WorkosSession } from "./workos-session";

const PROFILE_PENDING_RETRIES = 8;
const PROFILE_PENDING_DELAY_MS = 1500;

async function ensureUser(
  convexUrl: string,
  accessToken: string
): Promise<FunctionReturnType<typeof api.workosBootstrap.ensureUser>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const client = new ConvexHttpClient(convexUrl, {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      }),
  });
  client.setAuth(accessToken);
  try {
    return await client.mutation(api.workosBootstrap.ensureUser, {});
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

const sessions = new Map<string, WorkosSession>();
export function getWorkosSession(clientId: string): WorkosSession {
  let session = sessions.get(clientId);
  if (!session) {
    session = new WorkosSession(
      clientId,
      SecureStore,
      fetch,
      10_000,
      async (accessToken) => {
        const convexUrl = getConvexUrl();
        let result = await ensureUser(convexUrl, accessToken);
        // A brand-new user's profile arrives by WorkOS webhook, which can land
        // a moment after the code exchange. Wait briefly for it.
        for (
          let retry = 0;
          retry < PROFILE_PENDING_RETRIES &&
          result.status === "quarantined" &&
          result.reason === "profile_pending";
          retry += 1
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, PROFILE_PENDING_DELAY_MS)
          );
          result = await ensureUser(convexUrl, accessToken);
        }
        if (result.status !== "ok") {
          if (result.status === "verify_email") {
            throw new Error("Verify your email before opening your vault.");
          }
          if (result.status === "frozen") {
            throw new Error(SIGNUPS_PAUSED_MESSAGE);
          }
          throw new Error(
            "Unable to open your vault. Please try again or contact support."
          );
        }
      }
    );
    sessions.set(clientId, session);
  }
  return session;
}

const discovery = {
  authorizationEndpoint: "https://api.workos.com/user_management/authorize",
};
export const WORKOS_REDIRECT_URI = "teak://auth/callback";
WebBrowser.maybeCompleteAuthSession();

// Only the public client ID crosses the native boundary. Expo generates state
// and the S256 verifier/challenge; the system browser handles every provider.
export async function signInWithWorkos(
  session: WorkosSession,
  provider: "authkit" | "GoogleOAuth" | "AppleOAuth" = "authkit",
  screenHint?: "sign-in" | "sign-up"
): Promise<boolean> {
  await session.hydrate();
  const attempt = session.beginSignIn();
  const request = new AuthRequest({
    clientId: session.clientId,
    redirectUri: WORKOS_REDIRECT_URI,
    responseType: ResponseType.Code,
    usePKCE: true,
    codeChallengeMethod: CodeChallengeMethod.S256,
    extraParams: {
      provider,
      ...(screenHint ? { screen_hint: screenHint } : {}),
    },
  });
  await request.makeAuthUrlAsync(discovery);
  // A private browser session keeps no AuthKit cookie after sign-in, so Log
  // Out only needs the server revocation and never a browser logout. Apple
  // returns to WorkOS with a cross-site form POST, which App Review saw fail
  // in a private session; it never sets AuthKit's cookie, so it uses the
  // shared session.
  const result = await request.promptAsync(discovery, {
    preferEphemeralSession: provider !== "AppleOAuth",
  });
  if (
    result.type === "cancel" ||
    result.type === "dismiss" ||
    (result.type === "error" && result.params.error === "access_denied")
  ) {
    return false;
  }
  if (result.type === "error") {
    // The alert stays generic; the WorkOS reason is what diagnoses a failure.
    console.error(
      "WorkOS sign-in callback error:",
      result.params.error,
      result.params.error_description
    );
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
