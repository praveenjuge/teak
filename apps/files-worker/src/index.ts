import { FILES_CACHE_CONTROL, verifySignedFileRequest } from "./lib";

export interface Env {
  BUCKET: R2Bucket;
  FILES_SIGNING_SECRET: string;
}

const decodeObjectKey = (pathname: string): string => {
  try {
    return decodeURIComponent(pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
};

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method !== "GET") {
      return new Response(null, { status: 405 });
    }

    const url = new URL(request.url);
    const key = decodeObjectKey(url.pathname);
    if (!key || key.includes("..")) {
      return new Response(null, { status: 404 });
    }

    const verification = await verifySignedFileRequest(
      env.FILES_SIGNING_SECRET,
      {
        key,
        exp: url.searchParams.get("exp"),
        sig: url.searchParams.get("sig"),
        ct: url.searchParams.get("ct"),
        cd: url.searchParams.get("cd"),
      }
    );
    if (!verification.ok) {
      return new Response(null, { status: verification.status });
    }

    const object = await env.BUCKET.get(key);
    if (!object) {
      return new Response(null, { status: 404 });
    }

    const headers = new Headers();
    headers.set("Cache-Control", FILES_CACHE_CONTROL);
    headers.set("ETag", object.httpEtag);
    headers.set(
      "Content-Type",
      url.searchParams.get("ct") ||
        object.httpMetadata?.contentType ||
        "application/octet-stream"
    );
    const contentDisposition =
      url.searchParams.get("cd") || object.httpMetadata?.contentDisposition;
    if (contentDisposition) {
      headers.set("Content-Disposition", contentDisposition);
    }
    return new Response(object.body, { headers });
  },
} satisfies ExportedHandler<Env>;
