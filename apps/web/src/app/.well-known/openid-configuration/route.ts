import {
  oauthMetadataPreflight,
  proxyAuthorizationServerMetadata,
} from "@/lib/oauth-metadata-proxy";

// Some OAuth clients probe OIDC discovery first. Serve the same
// authorization-server document so either discovery path succeeds.
export const dynamic = "force-dynamic";

export function GET() {
  return proxyAuthorizationServerMetadata();
}

export function OPTIONS() {
  return oauthMetadataPreflight();
}
