import { z } from "zod";
import {
  PUBLIC_API_BODIES,
  type PublicApiBodyOperationId,
} from "../../shared/publicApiBodies";

type JsonSchema = Record<string, unknown>;

const isNullType = (schema: unknown) =>
  Boolean(
    schema &&
      typeof schema === "object" &&
      (schema as JsonSchema).type === "null" &&
      Object.keys(schema).length === 1
  );

/**
 * Zod's JSON Schema in this document's style: a nullable value is
 * `type: [T, "null"]` (with `null` in its `enum`), not an `anyOf`.
 */
const inDocumentStyle = (schema: unknown): unknown => {
  if (Array.isArray(schema)) {
    return schema.map(inDocumentStyle);
  }
  if (!schema || typeof schema !== "object") {
    return schema;
  }
  const node = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, inDocumentStyle(value)])
  ) as JsonSchema;
  const { anyOf, ...rest } = node;
  if (!(Array.isArray(anyOf) && anyOf.length === 2)) {
    return node;
  }
  const nullIndex = anyOf.findIndex(isNullType);
  const other = anyOf[1 - nullIndex] as JsonSchema | undefined;
  if (nullIndex === -1 || typeof other?.type !== "string") {
    return node;
  }
  return {
    ...rest,
    ...other,
    type: [other.type, "null"],
    ...(Array.isArray(other.enum) ? { enum: [...other.enum, null] } : {}),
  };
};

/** An operation's request body as OpenAPI's JSON Schema. */
export const requestBodySchema = (
  operationId: PublicApiBodyOperationId
): JsonSchema => {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(
    PUBLIC_API_BODIES[operationId],
    { io: "input" }
  ) as JsonSchema;
  return inDocumentStyle(schema) as JsonSchema;
};
