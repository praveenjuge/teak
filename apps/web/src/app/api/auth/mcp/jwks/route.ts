import { mcpJwks, mcpOAuthPreflight } from "@/lib/mcp-oauth-endpoints";

export const dynamic = "force-dynamic";

export function GET() {
  return mcpJwks();
}

export function OPTIONS() {
  return mcpOAuthPreflight();
}
