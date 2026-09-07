import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { httpAction, internalMutation } from "./_generated/server";
import {
  isWellFormedOAuthToken,
  OAUTH_ACCESS_TOKEN_MODEL,
} from "./oauthTokens";

// Revoke only the credential pair presented by this client. Settings retains
// its existing app-wide revocation behavior across all installations.
export const revokeToken = internalMutation({
  args: { token: v.string(), clientId: v.string() },
  returns: v.null(),
  handler: async (ctx, { token, clientId }) => {
    for (const field of ["refreshToken", "accessToken"] as const) {
      const record = await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: OAUTH_ACCESS_TOKEN_MODEL,
        where: [
          { field, operator: "eq", value: token },
          { field: "clientId", operator: "eq", value: clientId },
        ],
      });
      if (record) {
        await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
          input: {
            model: OAUTH_ACCESS_TOKEN_MODEL,
            where: [{ field: "_id", operator: "eq", value: record._id }],
          },
        });
        break;
      }
    }
    return null;
  },
});

export const revokeOAuthToken = httpAction(async (ctx, request) => {
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  ) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  // Bound the stream before parsing untrusted form data.
  const reader = request.body?.getReader();
  if (!reader) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  let body = "";
  let size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > 2048) {
      await reader.cancel();
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  const form = new URLSearchParams(body);
  const token = form.get("token") ?? "";
  const clientId = form.get("client_id") ?? "";
  if (!clientId || clientId.length > 256 || !token) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (isWellFormedOAuthToken(token)) {
    await ctx.runMutation(internal.oauthRevocation.revokeToken, {
      token,
      clientId,
    });
  }
  // RFC 7009: unknown, expired, and already revoked tokens all succeed.
  return new Response(null, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
});
