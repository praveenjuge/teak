import { env, httpAction } from "../_generated/server";

const manifestUrl =
  "https://reminiscent-kangaroo-59.convex.site/migration/connect-readiness.json";

// Public metadata for the Phase R client; never available in another environment.
export const clientMetadata = httpAction(() => {
  if (env.WORKOS_ENVIRONMENT_ID !== "environment_01KBYSVN9RVQ1JXACG3MDMQZGA") {
    return Promise.resolve(new Response("Not found", { status: 404 }));
  }
  return Promise.resolve(
    Response.json(
      {
        client_id: manifestUrl,
        client_name: "Teak CIMD readiness",
        redirect_uris: ["http://127.0.0.1:14210/oauth/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "openid profile email offline_access",
      },
      { headers: { "Cache-Control": "public, max-age=60" } }
    )
  );
});
