import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { V1_ENDPOINTS } from "../publicApi/http/meta";
import { openApiSpec } from "../publicApi/openApi/spec";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

test.each([
  ["DELETE", "/v1/cards", "GET, POST, OPTIONS"],
  ["GET", "/v1/highlights/h1", "PATCH, DELETE, OPTIONS"],
  ["POST", "/v1/me", "GET, OPTIONS"],
])("%s %s answers a JSON 405 with Allow", async (method, path, allow) => {
  const t = convexTest(schema, modules);
  const response = await t.fetch(path, { method });
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe(allow);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(await response.json()).toMatchObject({ code: "METHOD_NOT_ALLOWED" });
});

test.each([
  ["GET", "/v1/highlights/h1/extra"],
  ["PUT", "/v1/tags/operations/op1/more"],
])(
  "%s %s, an extra segment under a route, is a JSON 404",
  async (method, path) => {
    const t = convexTest(schema, modules);
    const response = await t.fetch(path, { method });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  }
);

test("an unknown /v1 path answers a JSON 404 with CORS headers", async () => {
  const t = convexTest(schema, modules);
  const response = await t.fetch("/v1/nothing-here", { method: "GET" });
  expect(response.status).toBe(404);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
  expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  expect(
    (await t.fetch("/v1/nothing-here", { method: "OPTIONS" })).status
  ).toBe(204);
});

test("routed endpoints still reach their handlers", async () => {
  const t = convexTest(schema, modules);
  expect((await t.fetch("/v1/cards", { method: "GET" })).status).toBe(401);
  expect((await t.fetch("/v1/cards/c1", { method: "GET" })).status).toBe(401);
});

test("GET /v1 lists exactly the /v1 operations the OpenAPI document describes", () => {
  const described = Object.entries(openApiSpec.paths).flatMap(
    ([path, operations]) =>
      Object.keys(operations).map(
        (method) =>
          `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`
      )
  );
  expect([...V1_ENDPOINTS].sort()).toEqual(
    described.filter((operation) => operation.includes(" /v1/")).sort()
  );
});

test.each([
  ["GET", "/v1/cards/c1/save-pdf", "POST, OPTIONS"],
  ["PUT", "/v1/folders/f1/cards", "POST, DELETE, OPTIONS"],
])(
  "%s %s, a card or folder path served for other methods, is 405",
  async (method, path, allow) => {
    const t = convexTest(schema, modules);
    const response = await t.fetch(path, { method });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe(allow);
  }
);

test.each([
  "/v1/me",
  "/v1/cards",
  "/v1/cards/c1/highlights",
  "/v1/oauth/disconnect",
  "/v1/tags/operations/op1",
])("OPTIONS %s answers the CORS preflight", async (path) => {
  const t = convexTest(schema, modules);
  const response = await t.fetch(path, { method: "OPTIONS" });
  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
    "PATCH"
  );
});
