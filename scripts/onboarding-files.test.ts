import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ONBOARDING_DIR,
  OUTPUT,
  renderOnboardingFiles,
} from "./onboarding-files.ts";

test("the embedded getting-started files match the files on disk", () => {
  expect(readFileSync(OUTPUT, "utf8")).toBe(
    renderOnboardingFiles(ONBOARDING_DIR)
  );
});
