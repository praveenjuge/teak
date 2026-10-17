import { describe, expect, test } from "bun:test";
import { mergeDotenvValue } from "./sync-files-worker-dev-secret.ts";

describe("mergeDotenvValue", () => {
  test("updates the signing secret without dropping other local vars", () => {
    expect(
      mergeDotenvValue(
        "POSTHOG_PROJECT_TOKEN=phc_example\nFILES_SIGNING_SECRET=old\n",
        "FILES_SIGNING_SECRET",
        "new"
      )
    ).toBe("POSTHOG_PROJECT_TOKEN=phc_example\nFILES_SIGNING_SECRET=new\n");
  });
});
