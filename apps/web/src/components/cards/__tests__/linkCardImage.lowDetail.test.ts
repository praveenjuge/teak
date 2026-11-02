import { describe, expect, test } from "bun:test";
import { resolveLinkCardImage } from "../linkCardImage";

const SCREENSHOT = "https://files.teakvault.com/cards/screenshot.jpg";
const IMAGE = "https://files.teakvault.com/cards/og.jpg";

const link = (preview: Record<string, unknown>, extra = {}) =>
  ({
    _id: "card_1",
    metadata: {
      linkPreview: {
        screenshotHeight: 720,
        screenshotStorageKey: "cards/screenshot.jpg",
        screenshotWidth: 1280,
        status: "success",
        ...preview,
      },
    },
    screenshotUrl: SCREENSHOT,
    type: "link",
    url: "https://example.com/",
    ...extra,
  }) as never;

describe("a link whose screenshot shows next to nothing", () => {
  test("uses the text layout instead of a grey tile", () => {
    expect(
      resolveLinkCardImage(link({ screenshotBytes: 9 * 1024 }), false)
    ).toBeUndefined();
  });

  test("still shows an ordinary page's screenshot", () => {
    expect(
      resolveLinkCardImage(link({ screenshotBytes: 110 * 1024 }), false)?.src
    ).toBe(SCREENSHOT);
  });

  test("still shows a screenshot it hasn't measured", () => {
    expect(resolveLinkCardImage(link({}), false)?.src).toBe(SCREENSHOT);
  });

  test("keeps the page's own image, and drops to text when that fails", () => {
    const card = link(
      { imageStorageKey: "cards/og.jpg", screenshotBytes: 9 * 1024 },
      { linkPreviewImageUrl: IMAGE }
    );
    expect(resolveLinkCardImage(card, false)?.src).toBe(IMAGE);
    // useScreenshot: the page's image failed to load.
    expect(resolveLinkCardImage(card, true)).toBeUndefined();
  });
});
