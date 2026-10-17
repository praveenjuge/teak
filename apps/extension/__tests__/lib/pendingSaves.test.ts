import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getPendingSave,
  listPendingSaveIds,
  type PendingSave,
  removePendingSave,
  storePendingSave,
  updatePendingSave,
  waitingSaveIds,
} from "../../lib/pendingSaves";
import { installChromeStorage } from "../helpers/chromeStorage";

describe("waitingSaveIds", () => {
  test("does not count a save that is still running as pending", () => {
    expect(waitingSaveIds(["in-flight"], new Set(["in-flight"]))).toEqual([]);
  });

  test("keeps saves that stopped without finishing", () => {
    expect(
      waitingSaveIds(["failed", "in-flight", "offline"], new Set(["in-flight"]))
    ).toEqual(["failed", "offline"]);
  });
});

describe("a Firefox private session", () => {
  const originalBrowser = process.env.BROWSER;
  const originalChrome = globalThis.chrome;
  const save = (id: string): PendingSave => ({
    id,
    createdAt: 1,
    kind: "content",
    input: { content: `https://example.com/${id}`, source: "context-menu" },
  });

  beforeEach(() => {
    process.env.BROWSER = "firefox";
    installChromeStorage({ extension: { inIncognitoContext: true } });
  });
  afterEach(async () => {
    for (const id of await listPendingSaveIds()) {
      await removePendingSave(id);
    }
    process.env.BROWSER = originalBrowser;
    globalThis.chrome = originalChrome;
  });

  // IndexedDB can't open there, and Bun has none: any use of it would throw.
  test("keeps pending saves in memory", async () => {
    await storePendingSave(save("a"));
    await storePendingSave(save("b"));
    expect(await listPendingSaveIds()).toEqual(["a", "b"]);
    await updatePendingSave({ ...save("a"), firstAttemptAt: 5 });
    expect(await getPendingSave("a")).toMatchObject({ firstAttemptAt: 5 });
    await removePendingSave("a");
    expect(await listPendingSaveIds()).toEqual(["b"]);
    expect(await getPendingSave("a")).toBeUndefined();
  });

  test("still stops at 20 waiting saves", async () => {
    for (let index = 0; index < 20; index += 1) {
      await storePendingSave(save(String(index)));
    }
    await expect(storePendingSave(save("one-more"))).rejects.toThrow(
      "Finish your pending saves before adding more."
    );
  });
});
