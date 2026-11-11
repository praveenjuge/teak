import { EDGE_RATE_LIMIT_HEADER } from "@teak/files-protocol";
import type { z } from "zod";
import type { PublicApiOperationCall } from "../shared/publicApiContract";
import { captureBackendEvent } from "../telemetry/posthog";
import {
  findTeakTool,
  type JsonObject,
  type TeakTool,
  toObjectPayload,
} from "./catalog";

/** Runs one public API operation for a tool, as the signed-in caller. */
export type PublicApiToolExecutor = (
  call: PublicApiOperationCall
) => Promise<Response>;

export interface JsonRpcRequest {
  id?: null | number | string;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
}

interface McpToolResult {
  content: Array<{ text: string; type: "text" }>;
  isError?: boolean;
  structuredContent?: JsonObject;
}

const MCP_UNAUTHORIZED_MESSAGE = "Missing or invalid Authorization header";

const createTextContent = (text: string): McpToolResult["content"] => [
  { type: "text", text },
];

const parseResponsePayload = async (response: Response): Promise<unknown> => {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
};

/**
 * The summary, then the result as JSON. Hosts that render the card view (MCP
 * Apps) hand `structuredContent` to the view and only `content` to the model,
 * so the JSON is how the model sees card IDs and fields there.
 */
const successResult = (
  structuredContent: JsonObject,
  summary: string
): McpToolResult => ({
  structuredContent,
  content: [
    ...createTextContent(summary),
    ...createTextContent(JSON.stringify(structuredContent)),
  ],
});

const errorResult = (status: number, payload: unknown): McpToolResult => {
  const objectPayload = toObjectPayload(payload);
  const code =
    typeof objectPayload.code === "string"
      ? objectPayload.code
      : "INTERNAL_ERROR";
  const error =
    typeof objectPayload.error === "string"
      ? objectPayload.error
      : `Request failed with status ${status}`;

  return {
    isError: true,
    structuredContent: {
      ...objectPayload,
      status,
      code,
      error,
    },
    content: createTextContent(`${code}: ${error}`),
  };
};

const MAX_REPORTED_ISSUES = 3;

const acceptedFields = (schema: z.ZodType): string[] => {
  const shape = (schema as { shape?: unknown }).shape;
  return shape && typeof shape === "object" ? Object.keys(shape) : [];
};

const EXPECTED_TYPES: Record<string, string> = {
  array: "a list",
  boolean: "true or false",
  int: "a whole number",
  number: "a number",
  object: "an object",
  string: "a string",
};

const valueAt = (input: unknown, path: readonly PropertyKey[]): unknown => {
  let value = input;
  for (const key of path) {
    if (value === null || typeof value !== "object") {
      return;
    }
    value = (value as Record<PropertyKey, unknown>)[key];
  }
  return value;
};

/**
 * Says what is wrong with one argument in words an agent can act on:
 * `cardId` is required, `limit` must be a number. A message that already
 * names its argument is kept as it is, so the name isn't said twice.
 */
const describeArgumentIssue = (
  issue: z.core.$ZodIssue,
  input: unknown
): string => {
  const path = issue.path.map(String).join(".");
  if (!path) {
    return issue.message;
  }
  const name = `\`${path}\``;
  const missing =
    issue.code === "invalid_type" && valueAt(input, issue.path) === undefined;
  if (missing) {
    return `${name} is required`;
  }
  if (issue.path.length === 1 && issue.message.includes(name)) {
    return issue.message;
  }
  if (issue.code === "invalid_type") {
    const expected = EXPECTED_TYPES[issue.expected];
    if (expected) {
      return `${name} must be ${expected}`;
    }
  }
  if (
    (issue.code === "too_big" || issue.code === "too_small") &&
    (issue.origin === "number" || issue.origin === "int") &&
    issue.inclusive
  ) {
    return issue.code === "too_big"
      ? `${name} must be ${issue.maximum} or less`
      : `${name} must be ${issue.minimum} or more`;
  }
  return `${path}: ${issue.message}`;
};

/**
 * Names the argument each problem is in, so `get_card {}` says `cardId` is
 * required instead of only "expected string", and an unknown argument (say
 * `query` on a tool that takes `q`) lists the ones the tool takes.
 */
const describeIssues = (
  issues: readonly z.core.$ZodIssue[],
  input: unknown,
  accepted: readonly string[] = []
): string => {
  if (issues.length === 0) {
    return "Invalid input";
  }
  const described = issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    if (issue.code === "unrecognized_keys") {
      const keys = issue.keys.map((key) => `\`${key}\``).join(", ");
      const takes =
        accepted.length > 0
          ? `; this tool takes ${accepted.map((key) => `\`${key}\``).join(", ")}`
          : "";
      return `Unknown argument${issue.keys.length === 1 ? "" : "s"} ${keys}${takes}`;
    }
    return describeArgumentIssue(issue, input);
  });
  const more = issues.length - described.length;
  return more > 0
    ? `${described.join("; ")} (and ${more} more)`
    : described.join("; ");
};

const validationError = (message: string): McpToolResult =>
  errorResult(400, {
    code: "INVALID_INPUT",
    error: message,
  });

const executeToolCall = async (
  call: PublicApiOperationCall,
  request: Request,
  executor: PublicApiToolExecutor
): Promise<
  { ok: true; payload: JsonObject } | { ok: false; result: McpToolResult }
> => {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return {
      ok: false,
      result: errorResult(401, {
        code: "UNAUTHORIZED",
        error: MCP_UNAUTHORIZED_MESSAGE,
      }),
    };
  }

  const edgeRateLimit = request.headers.get(EDGE_RATE_LIMIT_HEADER);
  const response = await executor({
    ...call,
    headers: {
      ...(call.headers ?? {}),
      Authorization: authorization,
      ...(edgeRateLimit ? { [EDGE_RATE_LIMIT_HEADER]: edgeRateLimit } : {}),
    },
  });

  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    return {
      ok: false,
      result: errorResult(response.status, payload),
    };
  }

  return {
    ok: true,
    payload: toObjectPayload(payload),
  };
};

const runTool = async (
  tool: TeakTool<unknown>,
  input: unknown,
  request: Request,
  executor: PublicApiToolExecutor
): Promise<McpToolResult> => {
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    return validationError(
      describeIssues(parsed.error.issues, input, acceptedFields(tool.schema))
    );
  }
  const result = await executeToolCall(
    tool.call(parsed.data),
    request,
    executor
  );
  if (!result.ok) {
    return result.result;
  }
  const payload =
    tool.transform?.(result.payload, parsed.data) ?? result.payload;
  const toolResult = successResult(payload, tool.summary(payload, parsed.data));
  return tool.isError?.(payload)
    ? { ...toolResult, isError: true }
    : toolResult;
};

export const isTeakV1Tool = (name: string): boolean =>
  findTeakTool(name) !== undefined;

export const callTeakV1Tool = async (
  name: string,
  input: unknown,
  request: Request,
  executor: PublicApiToolExecutor
): Promise<McpToolResult> => {
  const tool = findTeakTool(name);
  if (!tool) {
    return errorResult(404, {
      code: "NOT_FOUND",
      error: `Unknown tool: ${name}`,
    });
  }

  const start = Date.now();
  let outcome: "ok" | "error" | "unauthorized" = "ok";
  let status: number | undefined;
  try {
    const result = await runTool(tool, input, request, executor);
    if (result.isError) {
      const structured = result.structuredContent as
        | { status?: unknown }
        | undefined;
      status =
        typeof structured?.status === "number" ? structured.status : undefined;
      outcome = status === 401 ? "unauthorized" : "error";
    }
    return result;
  } catch (error) {
    outcome = "error";
    throw error;
  } finally {
    await captureBackendEvent("mcp_tool_called", undefined, {
      duration_ms: Date.now() - start,
      outcome,
      status,
      tool: name,
    });
  }
};
