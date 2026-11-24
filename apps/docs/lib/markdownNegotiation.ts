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
// lacks a Markdown twin.
function markdownMiss(pathname: string, pageExists: boolean): Response {
  const body = pageExists
    ? `# No Markdown for ${pathname}\n\nThis page exists on teakvault.com, but only as HTML: ask for it with \`Accept: text/html\`. https://teakvault.com/llms.txt lists every agent-readable page, and https://teakvault.com/sitemap.xml lists every page.\n`
    : `# ${pathname} not found\n\nThere is no page at this address on teakvault.com. https://teakvault.com/llms.txt lists every agent-readable page, and https://teakvault.com/sitemap.xml lists every page.\n`;
  return new Response(body, {
    status: pageExists ? 406 : 404,
    headers: { "Content-Type": MARKDOWN_CONTENT_TYPE, Vary: "Accept" },
  });
}

// Answers an `Accept: text/markdown` request from the page's Markdown twin.
// Returns null for any other request so the caller serves the assets.
export async function negotiateMarkdown(
  request: Request,
  assets: SiteAssets
): Promise<Response | null> {
  if (!wantsMarkdown(request.headers.get("Accept"))) {
    return null;
  }
  const url = new URL(request.url);
  const markdownPath = markdownPathFor(url.pathname);
  if (markdownPath) {
    const twin = await assets.fetch(new Request(new URL(markdownPath, url)));
    if (twin.ok) {
      return markdownResponse(twin);
    }
  }
  const page = await assets.fetch(request);
  const exists =
    page.ok || (page.status >= 300 && page.status < 400);
  return markdownMiss(url.pathname, exists);
}
