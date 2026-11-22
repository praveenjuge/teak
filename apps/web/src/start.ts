import { isNotFound, isRedirect } from "@tanstack/react-router";
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import { getCookie, getRequest } from "@tanstack/react-start/server";
import { SESSION_HINT_COOKIE } from "@teak/convex/shared/sessionHint";
import { authkitMiddleware } from "@workos/authkit-tanstack-react-start";
import { reportServerError } from "@/server/errorReport";
import {
  sessionHintHeader,
  signInGuard,
  signInUnavailable,
} from "@/server/session";
import { configureWorkos } from "@/server/workos";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const workosSetupMiddleware = createMiddleware().server(
  ({ request, next }) => signInGuard(request) ?? next()
);

// A session AuthKit can't read or refresh (WorkOS down, say) answers 503, as
// before, not a crash. Only failures before the request gets past AuthKit
// count; anything later is the page's own error.
const authkitFailureMiddleware = createMiddleware().server(async ({ next }) => {
  const progress = { pastAuthKit: false };
  try {
    return await next({ context: { authkitProgress: progress } });
  } catch (error) {
    if (progress.pastAuthKit || error instanceof Response) {
      throw error;
    }
    return signInUnavailable();
  }
});

// AuthKit's middleware puts the request's auth on the context; its type
// doesn't flow through a composed middleware, so it's read through this.
type AuthContext =
  | {
      auth?: () => { user: unknown };
      authkitProgress?: { pastAuthKit: boolean };
    }
  | undefined;

// Keeps the readable session hint in line with the session on every
// response. AuthKit wraps this and adds its refreshed session cookie.
const sessionMiddleware = createMiddleware()
  .middleware([
    workosSetupMiddleware,
    authkitFailureMiddleware,
    authkitMiddleware(),
  ])
  .server(async ({ context, next }) => {
    const progress = (context as AuthContext)?.authkitProgress;
    if (progress) {
      progress.pastAuthKit = true;
    }
    const result = await next();
    const hint = sessionHintHeader(
      getCookie(SESSION_HINT_COOKIE),
      configureWorkos().origin,
      Boolean((context as AuthContext)?.auth?.().user)
    );
    if (!hint) {
      return result;
    }
    const response = new Response(result.response.body, result.response);
    response.headers.append("Set-Cookie", hint);
    return { ...result, response };
  });

// Start answers a server function that throws with an error response, so
// the error never reaches server.ts; it is reported here instead. Redirects
// and not-founds are answers, not failures.
const functionErrorMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    try {
      return await next();
    } catch (error) {
      if (!(isRedirect(error) || isNotFound(error))) {
        reportServerError(error, getRequest());
      }
      throw error;
    }
  }
);

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, sessionMiddleware],
  functionMiddleware: [functionErrorMiddleware],
}));
