import { describe, expect, test } from "bun:test";
import { TEAK_V1_TOOLS } from "../../mcp/catalog";
import { openApiSpec } from "../../publicApi/openApi/spec";

/**
 * What API and MCP clients read about Teak: the OpenAPI document served at
 * /openapi.json and the tools MCP's tools/list returns. Refactors behind
 * them must leave both unchanged, so a change here is a contract change
 * that needs an intended reason (and an update with `bun test -u`).
 */
const asServed = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("published API contract", () => {
  test("the OpenAPI document stays as published", () => {
    expect(asServed(openApiSpec)).toMatchSnapshot();
  });

  test("the MCP tool list stays as published", () => {
    expect(asServed(TEAK_V1_TOOLS)).toMatchSnapshot();
  });
});
