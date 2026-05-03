import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  const body = `User-agent: *
Allow: /

Sitemap: https://teakvault.com/sitemap-index.xml
`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain" },
  });
};
