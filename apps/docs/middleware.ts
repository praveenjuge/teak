import { rewrite } from "@vercel/functions";
import {
  markdownMirrorPath,
  prefersMarkdown,
} from "./lib/markdown-negotiation";

export const config = {
  matcher: [
    "/",
    "/docs",
    "/docs/:path*",
    "/changelog/:path*",
    "/reference/operations/:path*",
  ],
};

export default function middleware(request: Request) {
  if (!prefersMarkdown(request.headers.get("accept"))) {
    return;
  }

  const { pathname } = new URL(request.url);
  const mirrorPath = markdownMirrorPath(pathname);

  if (!mirrorPath) {
    return;
  }

  return rewrite(new URL(mirrorPath, request.url));
}
