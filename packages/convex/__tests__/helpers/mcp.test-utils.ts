import { afterEach, beforeEach, mock } from "bun:test";
import { handleMcpV1Request } from "../../mcp/httpServer";
import type { PublicApiToolExecutor } from "../../mcp/tools";

export interface JsonRpcSuccess {
  id: number;
  jsonrpc: "2.0";
  result: {
    tools?: Array<{ name: string }>;
    structuredContent?: Record<string, unknown>;
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
}

export const TEST_AUTHORIZATION = `Bearer teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`;

export const AUTHKIT_DOMAIN = "https://auth.teakvault.example";
const originalPublicOrigin = process.env.PUBLIC_ORIGIN;
const originalAuthkitDomain = process.env.WORKOS_AUTHKIT_DOMAIN;
const originalResourceOrigin = process.env.WORKOS_RESOURCE_ORIGIN;
export const EXPECTED_TOOL_NAMES = [
  "fetch",
  "search",
  "teak_v1_add_cards_to_folder",
  "teak_v1_bulk_cards",
  "teak_v1_check_duplicate_url",
  "teak_v1_create_card",
  "teak_v1_create_folder",
  "teak_v1_create_thumbnail_upload",
  "teak_v1_create_upload",
  "teak_v1_delete_card",
  "teak_v1_delete_folder",
  "teak_v1_delete_tag",
  "teak_v1_find_similar_cards",
  "teak_v1_get_card",
  "teak_v1_get_card_changes",
  "teak_v1_get_card_content",
  "teak_v1_get_card_links",
  "teak_v1_get_folder",
  "teak_v1_get_me",
  "teak_v1_get_tag_operation",
  "teak_v1_list_cards",
  "teak_v1_list_favorite_cards",
  "teak_v1_list_folders",
  "teak_v1_list_tags",
  "teak_v1_merge_tags",
  "teak_v1_refresh_card",
  "teak_v1_remove_cards_from_folder",
  "teak_v1_rename_tag",
  "teak_v1_reset_card_thumbnail",
  "teak_v1_restore_card",
  "teak_v1_save_card_pdf",
  "teak_v1_search_cards",
  "teak_v1_set_card_archived",
  "teak_v1_set_card_done",
  "teak_v1_set_card_favorite",
  "teak_v1_set_card_thumbnail",
  "teak_v1_update_card",
  "teak_v1_update_folder",
];

/** Sets the AuthKit domain for each test and restores the env after it. */
export const setUpMcpEnv = () => {
  beforeEach(() => {
    process.env.WORKOS_AUTHKIT_DOMAIN = AUTHKIT_DOMAIN;
  });
  afterEach(() => {
    if (originalPublicOrigin === undefined) {
      delete process.env.PUBLIC_ORIGIN;
    } else {
      process.env.PUBLIC_ORIGIN = originalPublicOrigin;
    }
    if (originalAuthkitDomain === undefined) {
      delete process.env.WORKOS_AUTHKIT_DOMAIN;
    } else {
      process.env.WORKOS_AUTHKIT_DOMAIN = originalAuthkitDomain;
    }
    if (originalResourceOrigin === undefined) {
      delete process.env.WORKOS_RESOURCE_ORIGIN;
    } else {
      process.env.WORKOS_RESOURCE_ORIGIN = originalResourceOrigin;
    }
  });
};

export const mcpRequest = (
  body: Record<string, unknown>,
  authorization = TEST_AUTHORIZATION
): Request =>
  new Request("https://api.teakvault.com/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: authorization,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify(body),
  });

export const initializeMcp = (ctx: any) =>
  handleMcpV1Request(
    ctx,
    mcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "teak-convex-tests",
          version: "1.0.0",
        },
      },
    })
  );

export const respondWith = (
  respond: (
    operation: Parameters<PublicApiToolExecutor>[0]
  ) => Response | Promise<Response>
) =>
  mock((operation: Parameters<PublicApiToolExecutor>[0]) =>
    Promise.resolve(respond(operation))
  );
