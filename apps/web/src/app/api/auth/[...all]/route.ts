import { inactiveAuthProvider } from "@/lib/auth-mode";
import { readAuthMode } from "@/lib/auth-mode-server";
import { handler } from "@/lib/auth-server";

async function activeHandler(request: Request, method: "GET" | "POST") {
  const mode = await readAuthMode();
  if (mode.primary !== "betterauth") {
    return inactiveAuthProvider();
  }
  const path = new URL(request.url).pathname;
  if (
    mode.accountChangesPaused &&
    /\/(?:change-email|change-password|set-password|delete-user|request-password-reset|reset-password)(?:\/|$)/.test(
      path
    )
  ) {
    return Response.json(
      {
        error: "account_changes_paused",
        message: "Account changes are paused. Please try again later.",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  return handler[method](request);
}

export function GET(request: Request) {
  return activeHandler(request, "GET");
}
export function POST(request: Request) {
  return activeHandler(request, "POST");
}

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
