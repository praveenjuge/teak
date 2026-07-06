import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env } from "./env";

export const connectMcp = async (apiKey: string) => {
  const client = new Client({ name: "teak-prod-e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(env.mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  });
  await client.connect(transport);
  return client;
};
