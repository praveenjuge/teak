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
        let result: FunctionReturnType<typeof api.workosBootstrap.ensureUser>;
        try {
          result = await client.mutation(api.workosBootstrap.ensureUser, {});
        } finally {
          clearTimeout(timer);
          controller.abort();
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
