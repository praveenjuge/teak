import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("sonner", () => ({
  toast: { success: () => undefined, error: () => undefined },
}));

mock.module("lucide-react", () => ({
  Copy: () => React.createElement("span", { "data-icon": "copy" }),
}));

const { PalettePreview } = await import("../PalettePreview");

const createPaletteCard = (overrides?: Record<string, unknown>) => ({
  _id: "card_palette",
  _creationTime: Date.now(),
  content: "Brand colors",
  createdAt: Date.now(),
  isDeleted: false,
  isFavorited: false,
  type: "palette",
  updatedAt: Date.now(),
  userId: "user_123",
  ...overrides,
});

describe("PalettePreview", () => {
  test("shows an empty state when no colors are present", () => {
    const markup = renderToStaticMarkup(
      <PalettePreview card={createPaletteCard({ colors: [] }) as any} />
    );

    expect(markup).toContain("No colors detected in this palette");
  });

  test("renders a copyable swatch for each color", () => {
    const markup = renderToStaticMarkup(
      <PalettePreview
        card={
          createPaletteCard({
            colors: [{ hex: "#FF0000" }, { hex: "#00FF00" }],
          }) as any
        }
      />
    );

    expect(markup).toContain("#FF0000");
    expect(markup).toContain("#00FF00");
    expect(markup).toContain("background-color:#FF0000");
    expect(markup).toContain("background-color:#00FF00");
    expect((markup.match(/data-icon="copy"/g) ?? []).length).toBe(2);
  });
});
