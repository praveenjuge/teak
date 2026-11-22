import { describe, expect, test } from "bun:test";
import { missingAssetResponse } from "../server/missingAsset";

describe("a file under /assets that reaches the Worker", () => {
  test("is a plain 404 that's never cached, not a rendered page", async () => {
    const response = missingAssetResponse(
      new Request("https://app.teak.test/assets/LibraryScreen-old123.js")
    );
    expect(response?.status).toBe(404);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("content-type")).toContain("text/plain");
    expect(await response?.text()).toBe("Not found");
  });

  test("leaves every other path to the app", () => {
    for (const path of ["/", "/assets", "/settings/assets/x.js", "/ingest/e"]) {
      expect(
        missingAssetResponse(new Request(`https://app.teak.test${path}`))
      ).toBeNull();
    }
  });
});
