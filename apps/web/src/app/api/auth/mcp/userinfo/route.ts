import { mcpOAuthPreflight, mcpUserInfo } from "@/lib/mcp-oauth-endpoints";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return mcpUserInfo(request);
}

export function POST(request: Request) {
  return mcpUserInfo(request);
}

export function OPTIONS() {
  return mcpOAuthPreflight();
}
