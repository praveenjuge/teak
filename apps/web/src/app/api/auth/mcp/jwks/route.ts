import { mcpJwks, mcpOAuthPreflight } from "@/lib/mcp-oauth-endpoints";

export function GET() {
  return mcpJwks();
}

export function OPTIONS() {
  return mcpOAuthPreflight();
}
