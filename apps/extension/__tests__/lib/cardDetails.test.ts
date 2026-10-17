/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import {
  createDraftKeeper,
  createPatchQueue,
  loadSaveDetails,
  patchCard,
} from "../../lib/cardDetails";
import { isPatchCardPayload } from "../../lib/cardPatch";
import type { CardPatchResponse } from "../../types/messages";

describe("patchCard", () => {
  test("sends only the fields that changed", async () => {
    const request = mock(async (_path: string, _init?: RequestInit) =>
      Response.json({ id: "card_1" })
    );
    expect(
      await patchCard({ cardId: "card_1", tags: ["design"] }, { request })
    ).toEqual({ status: "updated" });
    expect(request.mock.calls[0]?.[0]).toBe("/v1/cards/card_1");
    expect(request.mock.calls[0]?.[1]?.method).toBe("PATCH");
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      tags: ["design"],
    });
  });

  test("tries once more after a network error", async () => {
    let calls = 0;
    const request = mock(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(Response.json({ id: "card_1" }));
    });
    expect(
      await patchCard({ cardId: "card_1", notes: "hi" }, { request })
    ).toEqual({ status: "updated" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  test("gives up after a second network error", async () => {
    const request = mock(() =>
      Promise.reject(new TypeError("Failed to fetch"))
    );
    expect(
      await patchCard({ cardId: "card_1", notes: "hi" }, { request })
    ).toMatchObject({ status: "error", code: "NETWORK" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  test("explains a rate limit", async () => {
    const request = async () =>
      Response.json({ code: "RATE_LIMITED", error: "slow" }, { status: 429 });
    expect(
      await patchCard({ cardId: "card_1", tags: [] }, { request })
    ).toEqual({
      status: "error",
      code: "RATE_LIMITED",
      message: "Too many requests. Try again in a moment",
    });
  });

  test("passes on a refusal, such as another user's card", async () => {
    const request = async () =>
      Response.json(
        { code: "NOT_FOUND", error: "Card not found" },
        { status: 404 }
      );
    expect(
      await patchCard({ cardId: "card_x", tags: [] }, { request })
    ).toEqual({
      status: "error",
      code: "NOT_FOUND",
      message: "Card not found",
    });
  });

  test("asks to sign in when the session is gone", async () => {
    expect(
      await patchCard(
        { cardId: "card_1", tags: [] },
        { request: async () => null }
      )
    ).toEqual({ status: "unauthenticated" });
  });
});

describe("isPatchCardPayload", () => {
  test.each([
    ["tags", { cardId: "abc123", tags: ["design"] }],
    ["a note", { cardId: "abc123", notes: "x".repeat(10_000) }],
    ["a cleared note", { cardId: "abc123", notes: null }],
  ])("accepts %s", (_label, payload) => {
    expect(isPatchCardPayload(payload)).toBe(true);
  });

  test.each([
    ["no change", { cardId: "abc123" }],
    ["a path in the id", { cardId: "../me", tags: [] }],
    ["a tag over 64 characters", { cardId: "abc", tags: ["a".repeat(65)] }],
    ["a blank tag", { cardId: "abc", tags: [" "] }],
    ["too many tags", { cardId: "abc", tags: new Array(101).fill("t") }],
    ["a huge note", { cardId: "abc", notes: "x".repeat(100_001) }],
    ["tags that aren't strings", { cardId: "abc", tags: [1] }],
  ])("refuses %s", (_label, payload) => {
    expect(isPatchCardPayload(payload)).toBe(false);
  });
});

describe("loadSaveDetails", () => {
  const tags = Response.json({
    items: [
      { name: "rare", count: 1 },
      { name: "design", count: 9 },
      { name: "art", count: 9 },
    ],
  });

  test("offers the library's most used tags first", async () => {
    const request = mock(async () => tags.clone());
    expect(
      await loadSaveDetails({ cardId: "card_1", existing: false }, { request })
    ).toEqual({ status: "ok", libraryTags: ["art", "design", "rare"] });
    expect(request).toHaveBeenCalledTimes(1);
  });

  test("reads an existing card's own tags and note", async () => {
    const request = mock(async (path: string) =>
      path === "/v1/tags"
        ? tags.clone()
        : Response.json({ notes: null, tags: ["design"] })
    );
    expect(
      await loadSaveDetails({ cardId: "card_1", existing: true }, { request })
    ).toEqual({
      status: "ok",
      libraryTags: ["art", "design", "rare"],
      card: { notes: "", tags: ["design"] },
    });
  });

  test("fails when an existing card can't be read", async () => {
    const request = mock(async (path: string) =>
      path === "/v1/tags"
        ? tags.clone()
        : Response.json({ code: "NOT_FOUND", error: "Gone" }, { status: 404 })
    );
    expect(
      await loadSaveDetails({ cardId: "card_1", existing: true }, { request })
    ).toMatchObject({ status: "error", code: "NOT_FOUND" });
  });
});

describe("createPatchQueue", () => {
  test("lands one card's patches in the order they were sent", async () => {
    const landed: string[] = [];
    const releases: Array<() => void> = [];
    const send = mock(
      (payload: { cardId: string; notes?: string | null }) =>
        new Promise<CardPatchResponse>((resolve) => {
          releases.push(() => {
            landed.push(String(payload.notes));
            resolve({ status: "updated" });
          });
        })
    );
    const queue = createPatchQueue(send);
    const first = queue({ cardId: "card_1", notes: "old" });
    const second = queue({ cardId: "card_1", notes: "new" });
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    releases[0]?.();
    await first;
    await Promise.resolve();
    releases[1]?.();
    await second;
    expect(landed).toEqual(["old", "new"]);
  });
});

describe("createDraftKeeper", () => {
  test("sends the popup's last draft once, when the popup closes", async () => {
    const send = mock((_payload: unknown) =>
      Promise.resolve<CardPatchResponse>({ status: "updated" })
    );
    const keeper = createDraftKeeper(send);
    keeper.update({ draft: { cardId: "card_1", notes: "half" } });
    keeper.update({ draft: { cardId: "card_1", notes: "half typed" } });
    await keeper.flush();
    await keeper.flush();
    expect(send.mock.calls).toEqual([
      [{ cardId: "card_1", notes: "half typed" }],
    ]);
  });

  test("sends nothing once the popup saved everything", async () => {
    const send = mock((_payload: unknown) =>
      Promise.resolve<CardPatchResponse>({ status: "updated" })
    );
    const keeper = createDraftKeeper(send);
    keeper.update({ draft: { cardId: "card_1", notes: "saved" } });
    keeper.update({ draft: null });
    expect(await keeper.flush()).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  test("drops a draft that isn't a valid patch", async () => {
    const send = mock((_payload: unknown) =>
      Promise.resolve<CardPatchResponse>({ status: "updated" })
    );
    const keeper = createDraftKeeper(send);
    keeper.update({ draft: { cardId: "../me", tags: ["x"] } });
    await keeper.flush();
    expect(send).not.toHaveBeenCalled();
  });
});
