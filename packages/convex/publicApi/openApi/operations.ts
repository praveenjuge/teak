import {
  PUBLIC_API_OPERATION_IDS,
  PUBLIC_API_OPERATIONS,
  type PublicApiOperationId,
} from "../../shared/publicApiContract";

/** An OpenAPI operation object, without its `operationId`. */
export type OpenApiOperation = Readonly<Record<string, unknown>>;

/** OpenAPI operation objects by `operationId`. */
export type OpenApiOperations = Partial<
  Record<PublicApiOperationId, OpenApiOperation>
>;

/**
 * The document's `paths`, from each operation's method and path in the
 * contract and its description here, in contract order.
 */
export const buildOpenApiPaths = (
  operations: Record<PublicApiOperationId, OpenApiOperation>
): Record<string, Record<string, OpenApiOperation>> => {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  for (const operationId of PUBLIC_API_OPERATION_IDS) {
    const { method, path } = PUBLIC_API_OPERATIONS[operationId];
    paths[path] ??= {};
    paths[path][method.toLowerCase()] = {
      operationId,
      ...operations[operationId],
    };
  }
  return paths;
};
