import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import { authkitMiddleware } from "@workos/authkit-tanstack-react-start";
import { proxyAnalytics } from "@/server/analyticsProxy";
import { sessionHintHeader, signInGuard } from "@/server/session";
import { configureWorkos } from "@/server/workos";

const analyticsMiddleware = createMiddleware().server(
  async ({ request, next }) => (await proxyAnalytics(request)) ?? next()
);

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const workosSetupMiddleware = createMiddleware().server(
  ({ request, next }) => signInGuard(request) ?? next()
);

// AuthKit's middleware puts the request's auth on the context; its type
// doesn't flow through a composed middleware, so it's read through this.
type AuthContext = { auth?: () => { user: unknown } } | undefined;

// Keeps the readable session hint in line with the session on every
// response. AuthKit wraps this and adds its refreshed session cookie.
const sessionMiddleware = createMiddleware()
  .middleware([workosSetupMiddleware, authkitMiddleware()])
  .server(async ({ request, context, next }) => {
    const result = await next();
    const hint = sessionHintHeader(
      request,
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

export const startInstance = createStart(() => ({
  requestMiddleware: [analyticsMiddleware, csrfMiddleware, sessionMiddleware],
}));
