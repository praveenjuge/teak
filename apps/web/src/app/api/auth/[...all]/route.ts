import { handler } from "@/lib/auth-server";

export const { GET, POST } = handler;

// Browser-based MCP clients (e.g. claude.ai) preflight the OAuth token endpoint
// (`/api/auth/mcp/token`) cross-origin. The Better Auth GET/POST handler does
// not answer OPTIONS, so respond to the preflight here with permissive CORS.
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
