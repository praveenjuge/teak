/**
 * The MCP App Teak serves next to its tools: one HTML view that MCP Apps hosts
 * (Claude, ChatGPT) render inline for a card search, a card, a saved card or a
 * list of favorites. Kept free of the HTML itself so the edge can answer
 * `tools/list` and `resources/list` without bundling it.
 */
export const TEAK_APP_RESOURCE_URI = "ui://teak/cards.html";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

/** `_meta` for a tool whose result the view renders. Hosts read either key. */
export const TEAK_APP_TOOL_META = {
  ui: { resourceUri: TEAK_APP_RESOURCE_URI },
  "ui/resourceUri": TEAK_APP_RESOURCE_URI,
} as const;

export const TEAK_APP_RESOURCE = {
  uri: TEAK_APP_RESOURCE_URI,
  name: "teak-cards",
  title: "Teak cards",
  description:
    "Shows the cards a Teak tool returned: a grid for searches and lists, one card in detail, or the card just saved.",
  mimeType: MCP_APP_MIME_TYPE,
} as const;

const CLAUDE_SANDBOX_SUFFIX = ".claudemcpcontent.com";

/**
 * Claude serves an MCP App from a sandbox origin named after the server URL:
 * the first 32 hex characters of its SHA-256, under claudemcpcontent.com.
 */
export const claudeSandboxDomain = async (mcpUrl: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(mcpUrl)
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 32)}${CLAUDE_SANDBOX_SUFFIX}`;
};

/**
 * The `resources/read` result for the view. Card images load from the files
 * origin; the view makes no other requests, so nothing else is allowed.
 */
export const buildAppResourceContents = async ({
  filesOrigin,
  html,
  mcpUrl,
}: {
  filesOrigin: string;
  html: string;
  mcpUrl: string;
}) => ({
  contents: [
    {
      uri: TEAK_APP_RESOURCE_URI,
      mimeType: MCP_APP_MIME_TYPE,
      text: html,
      _meta: {
        ui: {
          csp: { resourceDomains: [filesOrigin], connectDomains: [] },
          domain: await claudeSandboxDomain(mcpUrl),
          prefersBorder: true,
        },
      },
    },
  ],
});
