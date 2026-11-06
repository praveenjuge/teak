import { env, httpAction } from "../../_generated/server";
import { resolveTeakDevApiUrl } from "../../devUrls";
import { withPublicApiGatewayHeaders } from "../http/meta";
import { cardOperations } from "./cards";
import { components } from "./components";
import { exportOperations } from "./exports";
import { folderOperations } from "./folders";
import { highlightOperations } from "./highlights";
import { metaOperations } from "./meta";
import { buildOpenApiPaths } from "./operations";
import { tagOperations } from "./tags";

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Teak API",
    version: "v1",
    description:
      "Public API for creating, querying, and syncing Teak cards. A 429 response carries Retry-After, RateLimit-Remaining, and RateLimit-Reset in seconds, plus RateLimit-Limit when the limit is known. A 503 SERVICE_UNAVAILABLE response means the service was briefly busy; retry after its Retry-After seconds.",
  },
  servers: [
    { url: "https://teakvault.com/api" },
    { url: "https://api.teakvault.com" },
    { url: resolveTeakDevApiUrl(env) },
  ],
  components,
  paths: buildOpenApiPaths({
    ...metaOperations,
    ...cardOperations,
    ...tagOperations,
    ...folderOperations,
    ...highlightOperations,
    ...exportOperations,
  }),
};

export const openApiV1 = httpAction(async () =>
  withPublicApiGatewayHeaders(
    new Response(JSON.stringify(openApiSpec), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    })
  )
);
