import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { createAuth } from "./auth";
import { readAuthPrimary } from "./env";
import { readResponseTextWithinLimit } from "./shared/boundedResponse";

async function authorized(value: string) {
  const expected = process.env.E2E_CLEANUP_TOKEN;
  if (!expected || value.length > 4096 || !value.startsWith("Bearer ")) {
    return false;
  }
  const digest = (token: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const [left, right] = await Promise.all([
    digest(value.slice(7)),
    digest(expected),
  ]);
  const actual = new Uint8Array(left),
    required = new Uint8Array(right);
  let mismatch = 0;
  for (let index = 0; index < actual.length; index++) {
    mismatch += Math.abs(actual[index] - required[index]);
  }
  return mismatch === 0;
}

function endpoint(operation: "provision" | "cleanup") {
  return httpAction(async (ctx, request) => {
    if (readAuthPrimary() === "betterauth") {
      return createAuth(ctx).handler(request);
    }
    if (
      request.headers.get("content-type")?.split(";", 1)[0].trim() !==
      "application/json"
    ) {
      return Response.json({ error: "Expected JSON" }, { status: 415 });
    }
    const authorization = request.headers.get("authorization") ?? "";
    if (!(await authorized(authorization))) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await readResponseTextWithinLimit(
      new Response(request.body),
      16 * 1024
    );
    if (body === null) {
      return Response.json({ error: "Request too large" }, { status: 413 });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    const data = payload as Record<string, unknown>;
    if (
      data.cursor !== undefined &&
      (typeof data.cursor !== "string" ||
        data.cursor.length > 8192 ||
        data.emails !== undefined)
    ) {
      return Response.json({ error: "Invalid sweep cursor" }, { status: 400 });
    }
    try {
      let result: { status: number; body: unknown };
      if (operation === "provision") {
        if (
          typeof data.email !== "string" ||
          typeof data.password !== "string" ||
          data.email.length > 254 ||
          data.password.length > 128
        ) {
          return Response.json({ error: "Invalid request" }, { status: 400 });
        }
        result = await ctx.runAction(internal.workosE2eActions.provision, {
          email: data.email.trim().toLowerCase(),
          password: data.password,
        });
      } else {
        if (
          data.emails !== undefined &&
          !(
            Array.isArray(data.emails) &&
            data.emails.length > 0 &&
            data.emails.length <= 20 &&
            data.emails.every(
              (email) => typeof email === "string" && email.length <= 254
            )
          )
        ) {
          return Response.json({ error: "Invalid request" }, { status: 400 });
        }
        result = await ctx.runAction(internal.workosE2eActions.cleanup, {
          ...(data.cursor === undefined
            ? {}
            : { cursor: data.cursor as string }),
          ...(data.emails === undefined
            ? {}
            : {
                emails: (data.emails as string[]).map((email) =>
                  email.trim().toLowerCase()
                ),
              }),
        });
      }
      return result
        ? Response.json(result.body, {
            status: result.status,
            headers: { "Cache-Control": "no-store" },
          })
        : Response.json({ error: "Invalid request" }, { status: 400 });
    } catch {
      return Response.json(
        { error: "E2E automation unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
  });
}
export const provisionE2e = endpoint("provision");
export const cleanupE2e = endpoint("cleanup");
