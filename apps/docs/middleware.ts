import { rewrite } from "@vercel/functions";
import { resolveMarkdownRequest } from "./lib/markdown-not-found";

// Everything except build output and static files. Requests that do not ask
// for Markdown return immediately, so ordinary traffic is unaffected.
export const config = {
  matcher: [
    "/((?!_next/|_vercel/|.*\\.(?:avif|css|gif|ico|jpe?g|js|json|png|svg|txt|webp|woff2?|xml)$).*)",
  ],
};

/** HEAD request without a Markdown Accept header, so it skips this middleware. */
async function probeStatus(url: URL): Promise<number | null> {
  try {
    const response = await fetch(url, {
      headers: { accept: "text/html" },
      method: "HEAD",
      redirect: "manual",
    });
    return response.status;
  } catch {
    return null;
  }
}

export default async function middleware(request: Request) {
  const resolution = await resolveMarkdownRequest(request, probeStatus);

  if (!resolution) {
    return;
  }

  if (resolution.kind === "not-found") {
    return resolution.response;
  }

  return rewrite(new URL(resolution.path, request.url));
}
