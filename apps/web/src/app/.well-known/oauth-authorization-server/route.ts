import {
  oauthMetadataPreflight,
  proxyAuthorizationServerMetadata,
} from "@/lib/oauth-metadata-proxy";

// Metadata is resolved per request from the Convex deployment; never statically
// cached at build time.
export const dynamic = "force-dynamic";

export function GET() {
  return proxyAuthorizationServerMetadata();
}

export function OPTIONS() {
  return oauthMetadataPreflight();
}
