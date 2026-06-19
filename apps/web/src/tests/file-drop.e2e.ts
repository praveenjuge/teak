import { expect, test } from "@playwright/test";
import { AuthHelper } from "./test-helpers";

const TEST_EMAIL = process.env.E2E_BETTER_AUTH_USER_EMAIL;
const TEST_PASSWORD = process.env.E2E_BETTER_AUTH_USER_PASSWORD;

const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PbzkowAAAABJRU5ErkJggg==";

/**
 * Fire a synthetic drag/drop sequence against the document so the global drop
 * provider treats it as a real file drop. Playwright's built-in `dispatchEvent`
 * can't construct DataTransfer directly, so we build one in-page.
 */
async function dispatchFileDrop(
  page: import("@playwright/test").Page,
  fileName: string,
  mimeType: string
) {
  await page.evaluate(
    ({ base64, name, type }) => {
      const byteCharacters = atob(base64);
      const bytes = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i += 1) {
        bytes[i] = byteCharacters.charCodeAt(i);
      }
      const file = new File([bytes], name, { type });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const fireEvent = (eventName: string) => {
        const event = new DragEvent(eventName, {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        });
        document.dispatchEvent(event);
      };

      fireEvent("dragenter");
      fireEvent("dragover");
      fireEvent("drop");
    },
    {
      base64: SAMPLE_PNG_BASE64,
      name: fileName,
      type: mimeType,
    }
  );
}

test.describe("Global file drop", () => {
  test.skip(
    !(TEST_EMAIL && TEST_PASSWORD),
    "Set E2E_BETTER_AUTH_USER_EMAIL and E2E_BETTER_AUTH_USER_PASSWORD to run file drop smoke tests."
  );

  test.beforeEach(async ({ page }) => {
    const authHelper = new AuthHelper(page);
    await authHelper.signInWithEmailAndPassword(TEST_EMAIL!, TEST_PASSWORD!);
    await page.waitForLoadState("networkidle");
  });

  test("drops a file on the cards page and drains the queue", async ({
    page,
  }) => {
    await page.goto("/");
    await dispatchFileDrop(page, "drop-smoke.png", "image/png");

    // The provider shows a single loading toast and then replaces it with a
    // result. We just assert that at least one of the two appeared quickly.
    await expect
      .poll(
        async () =>
          (await page.getByText(/uploading/i).count()) +
          (await page.getByText(/uploaded|failed/i).count()),
        { timeout: 10_000 }
      )
      .toBeGreaterThan(0);
  });

  test("drops a file on the settings page without navigating away", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings$/);

    await dispatchFileDrop(page, "settings-drop.png", "image/png");

    // Stay on settings; the upload happens in place.
    await expect(page).toHaveURL(/\/settings$/);
    await expect
      .poll(
        async () =>
          (await page.getByText(/uploading/i).count()) +
          (await page.getByText(/uploaded|failed/i).count()),
        { timeout: 10_000 }
      )
      .toBeGreaterThan(0);
  });
});
