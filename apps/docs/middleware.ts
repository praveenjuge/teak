import { rewrite } from "@vercel/functions";
import {
  markdownNotFoundResponse,
  resolveMarkdownRequest,
} from "./lib/markdown-negotiation";

export const config = {
  // Every page route, so unknown URLs can answer in Markdown too. API, MCP,
  // and platform paths are excluded here and again in the resolver.
  matcher: ["/((?!api(?:/|$)|mcp(?:/|$)|\\.well-known|_vercel|.*\\.[^/]+$).*)"],
};

export default async function middleware(request: Request) {
  const resolution = await resolveMarkdownRequest(request);

  if (resolution.type === "rewrite") {
    return rewrite(new URL(resolution.path, request.url));
  }

  if (resolution.type === "not-found") {
    return markdownNotFoundResponse(resolution.markdown, request.method);
  }
}
