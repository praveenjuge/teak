import type { ActionCtx } from "../../_generated/server";
import type { TeakUserId } from "../../securitySessions";
import type { WorkosResource } from "../../workos/tokens";

/** One authorized call to a public operation, as its handler receives it. */
export interface PublicApiCall {
  /** The parsed JSON body, for an operation that reads one. */
  body: unknown;
  ctx: ActionCtx;
  /** Decoded path parameters, by the names in the operation's path. */
  params: Readonly<Record<string, string>>;
  /** The request: its URL carries the query, its headers the credential. */
  request: Request;
  resource: WorkosResource;
  userId: TeakUserId;
}

export type PublicApiHandler = (call: PublicApiCall) => Promise<Response>;

export const queryOf = (call: Pick<PublicApiCall, "request">) =>
  new URL(call.request.url).searchParams;

export const noContent = (): Response =>
  new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
