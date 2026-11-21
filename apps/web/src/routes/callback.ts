import { createFileRoute } from "@tanstack/react-router";
import { handleCallbackRoute } from "@workos/authkit-tanstack-react-start";
import { authMethodCookie } from "@/lib/auth-method";
import { signInPath } from "@/lib/authUrls";
import { type CookieInit, withCookies } from "@/lib/cookie";
import { sessionHintCookie } from "@/lib/session-hint";
import { configureWorkos } from "@/server/workos";

export const Route = createFileRoute("/callback")({
  server: {
    handlers: {
      GET: async (ctx) => {
        const { origin } = configureWorkos();
        let signedIn = false;
        let method: string | undefined;
        const response = await handleCallbackRoute({
          onSuccess: ({ authenticationMethod }) => {
            signedIn = true;
            method = authenticationMethod;
          },
          // Ask for credentials again, so an existing AuthKit session can't
          // send the browser straight back into the same failure.
          errorRedirectUrl: signInPath({ reauth: true }),
        })(ctx);
        if (!signedIn) {
          return response;
        }
        const cookies: CookieInit[] = [sessionHintCookie(origin, true)];
        if (method) {
          cookies.push(
            authMethodCookie(method, new URL(origin).protocol === "https:")
          );
        }
        return withCookies(response, cookies);
      },
    },
  },
});
