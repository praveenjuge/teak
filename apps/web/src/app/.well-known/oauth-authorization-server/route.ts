import {
  oauthMetadataPreflight,
  proxyAuthorizationServerMetadata,
} from "@/lib/oauth-metadata-proxy";

export function GET() {
  return proxyAuthorizationServerMetadata();
}

export function OPTIONS() {
  return oauthMetadataPreflight();
}
