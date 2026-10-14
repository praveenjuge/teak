import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ONBOARDING_DIR,
  OUTPUT,
  renderOnboardingFiles,
} from "./onboarding-files.ts";

// The backend embeds these bytes; a file changed without regenerating would
// give new accounts the old image, memo, PDF, or video.
test("the embedded getting-started files match the files on disk", () => {
  expect(readFileSync(OUTPUT, "utf8")).toBe(
    renderOnboardingFiles(ONBOARDING_DIR)
  );
});
