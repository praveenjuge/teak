/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  captureExtensionEvent,
  captureExtensionException,
} from "../../lib/telemetry";

const originalFetch = globalThis.fetch;
const originalChrome = globalThis.chrome;
const originalToken = process.env.WXT_POSTHOG_PROJECT_TOKEN;
let fetchMock: ReturnType<typeof mock>;

const sentEvents = () =>
  fetchMock.mock.calls.flatMap(
    ([, init]) => JSON.parse(String((init as RequestInit).body)).batch
  );

beforeEach(() => {
  fetchMock = mock(async () => Response.json({ status: 1 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: "1.2.3" }) },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: "teak_owner_1" }),
        set: async () => undefined,
        setAccessLevel: async () => undefined,
      },
    },
  } as unknown as typeof chrome;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.chrome = originalChrome;
  if (originalToken === undefined) {
    delete process.env.WXT_POSTHOG_PROJECT_TOKEN;
  } else {
    process.env.WXT_POSTHOG_PROJECT_TOKEN = originalToken;
  }
});

describe("extension telemetry", () => {
  test("development builds without a token send nothing", async () => {
    delete process.env.WXT_POSTHOG_PROJECT_TOKEN;
    await captureExtensionEvent("extension_card_saved", { via: "content" });
    await captureExtensionException(new Error("boom"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("reports a save once, owned by the signed-in account", async () => {
    process.env.WXT_POSTHOG_PROJECT_TOKEN = "phc_test";
    await captureExtensionEvent("extension_card_saved", { via: "file" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEvents()).toMatchObject([
      {
        distinct_id: "teak_owner_1",
        event: "extension_card_saved",
        properties: {
          $lib: "teak-extension",
          $lib_version: "1.2.3",
          surface: "extension",
          via: "file",
        },
      },
    ]);
  });

  test("a telemetry outage never rejects", async () => {
    process.env.WXT_POSTHOG_PROJECT_TOKEN = "phc_test";
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("offline"))
    ) as unknown as typeof fetch;
    await expect(
      captureExtensionException(new Error("boom"))
    ).resolves.toBeUndefined();
  });
});
