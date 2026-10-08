import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { findWorkosConnectIssuer } from "./env";
import { PUBLIC_API_CORS_HEADERS } from "./publicApiMeta";
import { WORKOS_RESOURCES } from "./shared/workosResources";
import { verifyWorkosConnectToken } from "./workosTokens";

export const disconnectWorkosConsent = httpAction(async (ctx, request) => {
  const headers = { ...PUBLIC_API_CORS_HEADERS, "Cache-Control": "no-store" };
  const response = (status: number) => new Response(null, { status, headers });
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match || match[1].length > 16_384) {
    return response(401);
  }
  const issuer = findWorkosConnectIssuer();
  if (!issuer) {
    return response(503);
  }
  let unavailable = false;
  const principal = await verifyWorkosConnectToken(match[1], {
    issuer,
    audience: WORKOS_RESOURCES.api,
    revocationOnly: true,
    onUnavailable: () => {
      unavailable = true;
    },
  });
  if (!principal) {
    return response(unavailable ? 503 : 401);
  }
  try {
    const status: number = await ctx.runAction(
      internal.workosApplicationDisconnect.run,
      principal
    );
    return response(status);
  } catch {
    return response(503);
  }
});
