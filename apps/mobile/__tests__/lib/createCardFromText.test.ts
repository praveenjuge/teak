import { describe, expect, mock, test } from "bun:test";
import { createCardFromText } from "../../../mobile/lib/createCardFromText";

describe("createCardFromText", () => {
  test("preserves raw Markdown for text saves", async () => {
    const createCard = mock(async () => "card_text");
    const content = "\uFEFF  # Mobile\r\n\r\n- [ ] task  \n";

    await createCardFromText(content, { createCard });

    expect(createCard).toHaveBeenCalledWith({
      content,
      type: undefined,
      url: undefined,
    });
  });

  test("keeps implicit URL classification", async () => {
    const createCard = mock(async () => "card_link");
    await createCardFromText("https://example.com", { createCard });

    expect(createCard).toHaveBeenCalledWith({
      content: "https://example.com",
      type: "link",
      url: "https://example.com",
    });
  });
});
