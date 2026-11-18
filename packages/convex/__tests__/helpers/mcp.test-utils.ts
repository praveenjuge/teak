import { afterEach, beforeEach, mock } from "bun:test";
import {
  PUBLIC_API_OPERATIONS,
  type PublicApiOperationCall,
  publicApiPath,
} from "../../shared/publicApiContract";

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
  body: unknown,
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

/** A tool's call to the API as the HTTP request it stands for. */
export interface HttpCall {
  body?: unknown;
  headers?: HeadersInit;
  method: string;
  path: string;
  query?: PublicApiOperationCall["query"];
}

export const withHttp = (call: PublicApiOperationCall): HttpCall => ({
  method: PUBLIC_API_OPERATIONS[call.operationId].method,
  path: publicApiPath(call.operationId, call.params),
  ...(call.query === undefined ? {} : { query: call.query }),
  ...(call.body === undefined ? {} : { body: call.body }),
  ...(call.headers === undefined ? {} : { headers: call.headers }),
});

/** An executor that hands each call to `respond` as its HTTP request. */
export const httpMock = (
  respond: (operation: HttpCall) => Response | Promise<Response>
) =>
  mock((call: PublicApiOperationCall) =>
    Promise.resolve(respond(withHttp(call)))
  );

export const respondWith = httpMock;
