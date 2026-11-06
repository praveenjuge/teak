import { describe, expect, test } from "bun:test";
import type { PropertyValidators } from "convex/values";
import type { z } from "zod";
import { folderOwnerOperations } from "../../folder/folders";
import {
  PUBLIC_API_BODIES,
  type PublicApiBodyOperationId,
  parsePublicApiBody,
} from "../../shared/publicApiBodies";
import {
  PUBLIC_API_OPERATION_IDS,
  publicApiOperationSpec,
} from "../../shared/publicApiContract";

/** Each field and whether it may be left out. */
const zodFields = (id: PublicApiBodyOperationId) =>
  Object.fromEntries(
    Object.entries(
      PUBLIC_API_BODIES[id].shape as Record<string, z.ZodType>
    ).map(([name, field]) => [name, field.safeParse(undefined).success])
  );

const convexFields = (args: PropertyValidators, pathParams: string[] = []) =>
  Object.fromEntries(
    Object.entries(args)
      .filter(([name]) => !pathParams.includes(name))
      .map(([name, validator]) => [name, validator.isOptional === "optional"])
  );

describe("public API request bodies", () => {
  test("every declared body belongs to an operation that reads one", () => {
    const ids = Object.keys(PUBLIC_API_BODIES) as PublicApiBodyOperationId[];
    for (const id of ids) {
      expect(PUBLIC_API_OPERATION_IDS).toContain(id);
      expect(publicApiOperationSpec(id).body).toBe(true);
    }
  });

  test("the folder functions the API calls take exactly the body's fields", () => {
    expect(convexFields(folderOwnerOperations.create.args)).toEqual(
      zodFields("createFolder")
    );
    expect(
      convexFields(folderOwnerOperations.update.args, ["folderId"])
    ).toEqual(
      // Every update field is optional; the body asks for at least one.
      zodFields("updateFolder")
    );
  });

  test.each([
    [null, "Body must be a JSON object"],
    [[], "Body must be a JSON object"],
    [{ name: "Reading", kind: "smart" }, "A smart folder needs a `query`"],
    [{ name: "Reading", query: "tag:a" }, '`query` needs `kind: "smart"`'],
    [{ name: "   " }, "Name the folder"],
    [{ color: "red" }, "Body must include `name`"],
    [
      { name: "Reading", colour: "red" },
      "Body may include only `name`, `color`, `kind`, `query`, `autoTags`, `autoFileQuery` or `autoFileEnabled`",
    ],
    [
      { name: "Reading", autoFileEnabled: "yes" },
      "`autoFileEnabled` must be true or false",
    ],
  ])("a folder body %j is refused: %s", (body, message) => {
    expect(parsePublicApiBody("createFolder", body)).toEqual({
      error: message,
    });
  });

  test("a folder body's tags are trimmed, without blanks or repeats", () => {
    expect(
      parsePublicApiBody("createFolder", {
        name: "Reading",
        autoTags: [" design ", "design", ""],
      })
    ).toEqual({ body: { name: "Reading", autoTags: ["design"] } });
  });

  test("an update names at least one field", () => {
    expect(parsePublicApiBody("updateFolder", {})).toEqual({
      error:
        "Body must include `name`, `color`, `query`, `autoTags`, `autoFileQuery` or `autoFileEnabled`",
    });
    expect(parsePublicApiBody("updateFolder", { color: null })).toEqual({
      body: { color: null },
    });
  });
});
