import { describe, expect, it } from "bun:test";
import { extractPaletteColors } from "../colorUtils";

describe("extractPaletteColors", () => {
  it("deduplicates and preserves first-seen order", () => {
    const colors = extractPaletteColors("#112233, #445566, #112233");
    expect(colors.map((c) => c.hex)).toEqual(["#112233", "#445566"]);
  });

  it("captures labelled colours", () => {
    const colors = extractPaletteColors(
      "Primary: #0F4C81\nAccent - rgb(255, 0, 128)"
    );
    expect(colors[0]).toMatchObject({ hex: "#0F4C81", name: "Primary" });
    expect(colors[1]).toMatchObject({
      hex: "#FF0080",
      name: "Accent",
    });
  });

  it("handles CSS properties, variables, and Tailwind arbitrary values", () => {
    const input = `
      --brand-primary: #123456;
      color: #fff;
      bg-[#0fa];
      text-[rgba(10, 20, 30, 0.5)];
    `;
    const hexes = extractPaletteColors(input).map((c) => c.hex);
    expect(hexes).toContain("#123456");
    expect(hexes).toContain("#FFFFFF");
    expect(hexes).toContain("#00FFAA");
    expect(hexes).toContain("#0A141E");
  });

  it("enforces a maximum of 12 colours", () => {
    const input = Array.from({ length: 20 }, (_, i) => `#${(i + 1)
      .toString(16)
      .padStart(6, "0")}`).join(" ");
    const colors = extractPaletteColors(input);
    expect(colors).toHaveLength(12);
  });

  it("handles literal escaped newlines", () => {
    const input = "Primary: #0F4C81\\nAccent - rgb(255, 0, 128)";
    const colors = extractPaletteColors(input);
    expect(colors[0]).toMatchObject({ hex: "#0F4C81", name: "Primary" });
    expect(colors[1]).toMatchObject({ hex: "#FF0080", name: "Accent" });
  });

  it("parses single HSL colour", () => {
    const colors = extractPaletteColors("hsl(340, 100%, 50%)");
    expect(colors).toHaveLength(1);
    expect(colors[0].hex).toBe("#FF0055");
  });
});
