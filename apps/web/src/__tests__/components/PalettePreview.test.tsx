import { describe, expect, test } from "bun:test";
import { PalettePreview } from "@teak/ui/card-previews";
import { renderToStaticMarkup } from "react-dom/server";

const createPaletteCard = (overrides?: Record<string, unknown>) => ({
  _id: "card_123",
  _creationTime: Date.now(),
  colors: [{ hex: "#FF0000" }, { hex: "#00FF00" }],
  content: "Palette card",
  createdAt: Date.now(),
  isDeleted: false,
  isFavorited: false,
  tags: [],
  type: "palette",
  updatedAt: Date.now(),
  userId: "user_123",
  ...overrides,
});

describe("PalettePreview", () => {
  test("renders one button per color without nesting interactive buttons", () => {
    const markup = renderToStaticMarkup(
      <PalettePreview card={createPaletteCard() as any} />
    );

    expect((markup.match(/<button/g) ?? []).length).toBe(2);
    expect(markup).not.toContain('data-slot="button"');
    expect(markup).toContain("pointer-events-none");
  });
});
