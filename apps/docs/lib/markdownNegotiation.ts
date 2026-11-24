const MARKDOWN = "text/markdown";
const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

export interface SiteAssets {
  fetch: (input: Request | URL) => Promise<Response>;
}

export function wantsMarkdown(accept: string | null): boolean {
  if (!accept) {
    return false;
  }
  return accept.split(",").some((range) => {
    const [type, ...params] = range.split(";");
    if (type.trim().toLowerCase() !== MARKDOWN) {
      return false;
    }
    const q = params
      .map((param) => param.trim())
      .find((param) => param.startsWith("q="));
    return q ? Number.parseFloat(q.slice(2)) > 0 : true;
  });
}

// Blume writes each page's Markdown next to its HTML: / becomes /index.md,
// /docs becomes /docs.md. Asset paths, the ones with an extension, have no
// Markdown twin.
export function markdownPathFor(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, "");
  if (clean === "") {
    return "/index.md";
  }
  if ((clean.split("/").pop() ?? "").includes(".")) {
    return null;
  }
  return `${clean}.md`;
}

export function withVaryAccept(response: Response): Response {
  const existing = response.headers.get("Vary");
  const varies =
    existing?.split(",").map((value) => value.trim().toLowerCase()) ?? [];
  if (varies.includes("*") || varies.includes("accept")) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Vary", existing ? `${existing}, Accept` : "Accept");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function markdownResponse(asset: Response): Response {
  const headers = new Headers(asset.headers);
  headers.set("Content-Type", MARKDOWN_CONTENT_TYPE);
  return withVaryAccept(
    new Response(asset.body, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    })
  );
}

// Both misses carry a Markdown body with a way onward, which is what an agent
// needs to recover: 404 when the page itself doesn't exist, 406 when it only
// lacks a Markdown twin. The path is left out of the body so a crafted URL
// can't inject Markdown images or links.
function markdownMiss(pageExists: boolean, method: string): Response {
  const body = pageExists
    ? "# No Markdown for this page\n\nThis page exists on teakvault.com, but only as HTML: ask for it with `Accept: text/html`. https://teakvault.com/llms.txt lists every agent-readable page, and https://teakvault.com/sitemap.xml lists every page.\n"
    : "# Page not found\n\nThere is no page at this address on teakvault.com. https://teakvault.com/llms.txt lists every agent-readable page, and https://teakvault.com/sitemap.xml lists every page.\n";
  return new Response(method === "HEAD" ? null : body, {
    status: pageExists ? 406 : 404,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": MARKDOWN_CONTENT_TYPE,
      "X-Content-Type-Options": "nosniff",
      Vary: "Accept",
    },
  });
}

// Answers an `Accept: text/markdown` request from the page's Markdown twin.
// Returns null for anything else (other methods, asset paths with an
// extension, redirects) so the caller serves the assets as usual.
export async function negotiateMarkdown(
  request: Request,
  assets: SiteAssets
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }
  if (!wantsMarkdown(request.headers.get("Accept"))) {
    return null;
  }
  const url = new URL(request.url);
  const markdownPath = markdownPathFor(url.pathname);
  if (!markdownPath) {
    return null;
  }
  const twin = await assets.fetch(
    new Request(new URL(markdownPath, url), { method: request.method })
  );
  if (
    twin.ok &&
    twin.headers.get("Content-Type")?.includes(MARKDOWN) === true
  ) {
    return markdownResponse(twin);
  }
  if (twin.status >= 500) {
    return twin;
  }
  const page = await assets.fetch(request);
  if (page.status >= 300 && page.status < 400) {
    return page;
  }
  if (page.status >= 500) {
    return page;
  }
  return markdownMiss(page.ok, request.method);
}
