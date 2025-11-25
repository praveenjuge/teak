import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { polar } from "./billing";
import { authComponent, createAuth, REGISTRATION_CLOSED_MESSAGE } from "./auth";

const http = httpRouter();

const enforceRegistrationLimit = httpAction(async (ctx, request) => {
  const validation = await ctx.runQuery(api.auth.canRegisterNewUser);
  if (!validation.allowed) {
    const message = validation.message ?? REGISTRATION_CLOSED_MESSAGE;
    return new Response(JSON.stringify({ message }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const auth = createAuth(ctx);
  return auth.handler(request);
});

const registrationStatus = httpAction(async (ctx) => {
  const validation = await ctx.runQuery(api.auth.canRegisterNewUser);
  return new Response(JSON.stringify(validation), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

http.route({
  path: "/api/auth/sign-up/email",
  method: "POST",
  handler: enforceRegistrationLimit,
});

http.route({
  path: "/api/auth/registration-status",
  method: "GET",
  handler: registrationStatus,
});

// Register the webhook handler at /polar/events
polar.registerRoutes(http as any);

// Register authentication routes
authComponent.registerRoutes(http, createAuth);

export default http;
