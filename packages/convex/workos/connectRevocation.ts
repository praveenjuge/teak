import { internal } from "../_generated/api";
import { httpAction } from "../_generated/server";
import { findWorkosConnectIssuer, findWorkosResources } from "../env";
import { MAX_BEARER_LENGTH, parseBearer } from "../shared/bearer";
import { PUBLIC_API_CORS_HEADERS } from "../shared/publicApiHeaders";
import { verifyWorkosConnectTokenSignatureForRevocation } from "./tokens";

export const disconnectWorkosConsent = httpAction(async (ctx, request) => {
  const headers = { ...PUBLIC_API_CORS_HEADERS, "Cache-Control": "no-store" };
  const response = (status: number) => new Response(null, { status, headers });
  const token = parseBearer(request.headers.get("authorization"));
  if (!token || token.length > MAX_BEARER_LENGTH) {
    return response(401);
  }
  const issuer = findWorkosConnectIssuer();
  const resources = findWorkosResources();
  if (!(issuer && resources)) {
    return response(503);
  }
  let unavailable = false;
  const principal = await verifyWorkosConnectTokenSignatureForRevocation(
    token,
    {
      issuer,
      audience: resources.api,
      onUnavailable: () => {
        unavailable = true;
      },
    }
  );
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
