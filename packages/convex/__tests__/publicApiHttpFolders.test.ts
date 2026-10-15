import { describe, expect, mock, test } from "bun:test";
import { ConvexError } from "convex/values";
import { executePublicApiOperation } from "../publicApiHttp";
import type { PublicApiOperation } from "../publicApiHttpShared";
import { mockActionCtx } from "./helpers/convex.test-utils";
import { buildAuthorizedMutationMock } from "./helpers/publicApiHttp.test-utils";
import { withMappedOwner } from "./helpers/session.test-utils";

const AUTH = {
  Authorization: `Bearer teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`,
};

const folder = {
  _id: "folder_1",
  name: "Reading",
  color: "blue",
  kind: "manual",
  activeCardCount: 3,
  createdAt: 1,
  updatedAt: 2,
};

const run = (
  operation: PublicApiOperation,
  {
    query = mock().mockResolvedValue(null),
    mutation = mock().mockResolvedValue(null),
  }: {
    mutation?: ReturnType<typeof mock>;
    query?: ReturnType<typeof mock>;
  } = {}
) => {
  const runMutation = buildAuthorizedMutationMock();
  runMutation.mockImplementation((...args) => mutation(...args));
  const ctx = withMappedOwner({ runMutation, runQuery: query });
  return {
    ctx,
    response: executePublicApiOperation(mockActionCtx(ctx), {
      headers: AUTH,
      ...operation,
    }),
  };
};

const argsOf = (fn: ReturnType<typeof mock>, call = 0) =>
  fn.mock.calls[call]?.[1];

describe("public API folders", () => {
  test("lists folders with their card counts", async () => {
    const query = mock().mockResolvedValue([folder]);
    const { response } = run({ method: "GET", path: "/v1/folders" }, { query });
    const result = await response;
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      items: [
        {
          id: "folder_1",
          name: "Reading",
          color: "blue",
          kind: "manual",
          query: null,
          cardCount: 3,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });
  });

  test("creates a folder from a valid body only", async () => {
    const mutation = mock().mockResolvedValue({ ...folder, color: undefined });
    const created = await run(
      { method: "POST", path: "/v1/folders", body: { name: "Reading" } },
      { mutation }
    ).response;
    expect(created.status).toBe(201);
    expect((await created.json()).color).toBeNull();
    expect(argsOf(mutation)).toMatchObject({ name: "Reading" });

    for (const body of [
      {},
      { name: "  " },
      { name: "x".repeat(301) },
      { name: "Ok", color: "#00f" },
      { name: "Ok", color: null },
      { name: "Ok", extra: true },
    ]) {
      const refused = await run({ method: "POST", path: "/v1/folders", body })
        .response;
      expect(refused.status, JSON.stringify(body)).toBe(400);
    }
  });

  test("maps duplicate names and the folder cap to 409", async () => {
    for (const code of ["CONFLICT", "LIMIT_REACHED"]) {
      const mutation = mock().mockRejectedValue(
        new ConvexError({ code, message: "Nope" })
      );
      const response = await run(
        { method: "POST", path: "/v1/folders", body: { name: "Reading" } },
        { mutation }
      ).response;
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ code, error: "Nope" });
    }
  });

  test("renames, clears the color and deletes by id", async () => {
    const mutation = mock().mockResolvedValue(folder);
    const patched = await run(
      {
        method: "PATCH",
        path: "/v1/folders/folder_1",
        body: { name: "Later", color: null },
      },
      { mutation }
    ).response;
    expect(patched.status).toBe(200);
    expect(argsOf(mutation)).toMatchObject({
      folderId: "folder_1",
      name: "Later",
      color: null,
    });

    const empty = await run({
      method: "PATCH",
      path: "/v1/folders/folder_1",
      body: {},
    }).response;
    expect(empty.status).toBe(400);

    const deleted = await run(
      { method: "DELETE", path: "/v1/folders/folder_1" },
      { mutation: mock().mockResolvedValue("folder_1") }
    ).response;
    expect(deleted.status).toBe(204);
  });

  test("reports an unknown folder as 404", async () => {
    const got = await run({ method: "GET", path: "/v1/folders/missing" })
      .response;
    expect(got.status).toBe(404);

    const mutation = mock().mockRejectedValue(
      new ConvexError({ code: "NOT_FOUND", message: "Folder not found" })
    );
    const renamed = await run(
      { method: "PATCH", path: "/v1/folders/missing", body: { name: "X" } },
      { mutation }
    ).response;
    expect(renamed.status).toBe(404);

    const unknownRoute = await run({
      method: "GET",
      path: "/v1/folders/folder_1/other",
    }).response;
    expect(unknownRoute.status).toBe(404);
  });

  test("adds and removes up to 100 cards per call", async () => {
    const result = {
      updatedIds: ["card_1"],
      failedIds: ["card_2"],
      folderLimitIds: [],
    };
    const mutation = mock().mockResolvedValue(result);
    const added = await run(
      {
        method: "POST",
        path: "/v1/folders/folder_1/cards",
        body: { cardIds: ["card_1", "card_2", "card_1"] },
      },
      { mutation }
    ).response;
    expect(added.status).toBe(200);
    expect(await added.json()).toEqual(result);
    expect(argsOf(mutation)).toMatchObject({
      action: "add",
      cardIds: ["card_1", "card_2"],
    });

    const removeMutation = mock().mockResolvedValue(result);
    await run(
      {
        method: "DELETE",
        path: "/v1/folders/folder_1/cards",
        body: { cardIds: ["card_1"] },
      },
      { mutation: removeMutation }
    ).response;
    expect(argsOf(removeMutation)).toMatchObject({ action: "remove" });

    for (const body of [
      { cardIds: [] },
      { cardIds: Array.from({ length: 101 }, (_, index) => `card_${index}`) },
      { ids: ["card_1"] },
    ]) {
      const refused = await run({
        method: "POST",
        path: "/v1/folders/folder_1/cards",
        body,
      }).response;
      expect(refused.status).toBe(400);
    }
  });

  test("requires a valid key", async () => {
    const response = await executePublicApiOperation(
      mockActionCtx(withMappedOwner({ runMutation: mock(), runQuery: mock() })),
      { method: "GET", path: "/v1/folders" }
    );
    expect(response.status).toBe(401);
  });

  test("lists a folder's cards with ?folder= and 404s an unknown one", async () => {
    const missing = await run({
      method: "GET",
      path: "/v1/cards",
      query: { folder: "missing" },
    }).response;
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "Folder not found" });

    const query = mock((_ref, args) =>
      Promise.resolve(
        args.folderId === "folder_1" && args.scanLimit === undefined
          ? folder
          : { itemCursors: [], items: [], nextCursor: null, scannedRows: 0 }
      )
    );
    const found = await run(
      { method: "GET", path: "/v1/cards", query: { folder: "folder_1" } },
      { query }
    ).response;
    expect(found.status).toBe(200);
    const scanArgs = query.mock.calls
      .map((call) => call[1])
      .find((args) => args?.scanLimit !== undefined);
    expect(scanArgs).toMatchObject({ folderId: "folder_1" });
  });

  test("creates and edits a smart folder with kind and query", async () => {
    const smart = {
      ...folder,
      _id: "folder_2",
      name: "Design links",
      kind: "smart",
      query: "tag:design type:link",
      activeCardCount: 0,
    };
    const mutation = mock().mockResolvedValue(smart);
    const created = await run(
      {
        method: "POST",
        path: "/v1/folders",
        body: {
          name: "Design links",
          kind: "smart",
          query: "#design type:link",
        },
      },
      { mutation }
    ).response;
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      kind: "smart",
      query: "tag:design type:link",
      cardCount: null,
    });
    expect(argsOf(mutation)).toMatchObject({
      name: "Design links",
      kind: "smart",
      query: "#design type:link",
    });

    const edit = mock().mockResolvedValue(smart);
    const patched = await run(
      {
        method: "PATCH",
        path: "/v1/folders/folder_2",
        body: { query: "tag:design" },
      },
      { mutation: edit }
    ).response;
    expect(patched.status).toBe(200);
    expect(argsOf(edit)).toMatchObject({
      folderId: "folder_2",
      query: "tag:design",
    });

    for (const [method, path, body] of [
      ["POST", "/v1/folders", { name: "A", kind: "smart" }],
      ["POST", "/v1/folders", { name: "A", query: "tag:x" }],
      ["POST", "/v1/folders", { name: "A", kind: "magic", query: "x" }],
      ["POST", "/v1/folders", { name: "A", kind: "smart", query: 5 }],
      ["PATCH", "/v1/folders/folder_2", { kind: "manual" }],
    ] as [PublicApiOperation["method"], string, unknown][]) {
      const refused = mock();
      const response = await run({ method, path, body }, { mutation: refused })
        .response;
      expect(response.status).toBe(400);
      expect(refused).not.toHaveBeenCalled();
    }
  });

  test("adding cards to a smart folder is a 409", async () => {
    const mutation = mock().mockRejectedValue(
      new ConvexError({ code: "SMART_FOLDER", message: "Smart" })
    );
    const response = await run(
      {
        method: "POST",
        path: "/v1/folders/folder_2/cards",
        body: { cardIds: ["card_1"] },
      },
      { mutation }
    ).response;
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "SMART_FOLDER",
      error: "Smart",
    });
  });

  test("?folder= on a smart folder lists what its search and q both match", async () => {
    const smart = {
      ...folder,
      _id: "folder_2",
      kind: "smart",
      query: "tag:design type:link type:image",
    };
    const query = mock((_ref, args) =>
      Promise.resolve(
        args.folderId === "folder_2"
          ? smart
          : { items: [], pageInfo: { hasMore: false, nextCursor: null } }
      )
    );
    const found = await run(
      {
        method: "GET",
        path: "/v1/cards",
        query: { folder: "folder_2", q: "type:link notes" },
      },
      { query }
    ).response;
    expect(found.status).toBe(200);
    const searchArgs = query.mock.calls.at(-1)?.[1];
    expect(searchArgs).toMatchObject({
      tag: "design",
      type: "link",
      searchQuery: "notes",
    });
    expect(searchArgs.folderId).toBeUndefined();

    // Searches that cannot both match list nothing without reading cards.
    const none = mock((_ref, args) =>
      Promise.resolve(args.folderId === "folder_2" ? smart : null)
    );
    const empty = await run(
      {
        method: "GET",
        path: "/v1/cards",
        query: { folder: "folder_2", q: "type:text" },
      },
      { query: none }
    ).response;
    expect(await empty.json()).toEqual({
      items: [],
      pageInfo: { hasMore: false, nextCursor: null },
    });
    expect(none).toHaveBeenCalledTimes(1);
  });

  test("sets a card's folders with PATCH folderIds", async () => {
    const card = { _id: "card_1", userId: "user_1", type: "text" };
    const query = mock()
      .mockResolvedValueOnce("card_1")
      .mockResolvedValueOnce(card);
    const mutation = mock().mockResolvedValue({
      ...card,
      folderIds: ["folder_1"],
    });
    const response = await run(
      {
        method: "PATCH",
        path: "/v1/cards/card_1",
        body: { folderIds: ["folder_1"] },
      },
      { query, mutation }
    ).response;
    expect(response.status).toBe(200);
    expect((await response.json()).folderIds).toEqual(["folder_1"]);
    expect(argsOf(mutation)).toMatchObject({ folderIds: ["folder_1"] });

    const tooMany = await run(
      {
        method: "PATCH",
        path: "/v1/cards/card_1",
        body: { folderIds: Array.from({ length: 51 }, (_, i) => `f${i}`) },
      },
      {
        query: mock()
          .mockResolvedValueOnce("card_1")
          .mockResolvedValueOnce(card),
      }
    ).response;
    expect(tooMany.status).toBe(400);
  });
});
