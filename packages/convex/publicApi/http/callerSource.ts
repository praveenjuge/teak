import { env } from "../../_generated/server";
import type { ApiCardSource } from "../../card/createCard";
import type { OAuthSurface } from "../../shared/oauthSurfaces";
import type { WorkosResource } from "../../workos/tokens";

const SOURCE_BY_SURFACE: Record<OAuthSurface, ApiCardSource> = {
  chrome: "extension",
  cli: "cli",
  firefox: "extension",
  raycast: "raycast",
};

/** Teak's own WorkOS Connect clients this deployment knows, by client id. */
const configuredConnectClients = (): Readonly<Record<string, OAuthSurface>> => {
  const clients: [string | undefined, OAuthSurface][] = [
    [env.WORKOS_CONNECT_CLI_CLIENT_ID, "cli"],
    [env.WORKOS_CONNECT_RAYCAST_CLIENT_ID, "raycast"],
    [env.WORKOS_CONNECT_CHROME_CLIENT_ID, "chrome"],
    [env.WORKOS_CONNECT_FIREFOX_CLIENT_ID, "firefox"],
  ];
  return Object.fromEntries(
    clients.filter((entry): entry is [string, OAuthSurface] => !!entry[0])
  );
};

/**
 * Where an authorized API call came from, as the analytics `source` of the
 * cards it creates: the MCP server, one of Teak's signed-in clients (the CLI,
 * Raycast or the browser extension), or `api` for an API key or any other
 * client.
 */
export const cardSourceForCaller = (
  caller: { clientId?: string },
  resource: WorkosResource,
  clients: Readonly<Record<string, OAuthSurface>> = configuredConnectClients()
): ApiCardSource => {
  if (resource === "mcp") {
    return "mcp";
  }
  const surface = caller.clientId ? clients[caller.clientId] : undefined;
  return surface ? SOURCE_BY_SURFACE[surface] : "api";
};
