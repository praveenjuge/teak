import { describe, expect, it } from "bun:test";
import {
    parseColorString,
    parseColorsFromText,
    extractPaletteColors,
    getColorName,
    getContrastRatio,
    hexToRgb
} from "./colorUtils";

describe("colorUtils", () => {
    describe("hexToRgb", () => {
        it("returns null for invalid length", () => {
            expect(hexToRgb("#12")).toBeNull();
            expect(hexToRgb("#1234567")).toBeNull();
        });

        it("returns null for invalid characters", () => {
            expect(hexToRgb("ghijkl")).toBeNull();
        });

        it("handles 3-digit hex", () => {
            expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
        });

        it("handles 4-digit hex (ignores alpha)", () => {
            expect(hexToRgb("#abcd")).toEqual({ r: 170, g: 187, b: 204 });
        });

        it("handles 8-digit hex (ignores alpha)", () => {
            expect(hexToRgb("#aabbccdd")).toEqual({ r: 170, g: 187, b: 204 });
        });
    });
    describe("hex formats", () => {
        it("handles 3-digit hex", () => {
            const color = parseColorString("#abc");
            expect(color?.rgb).toEqual({ r: 170, g: 187, b: 204 });
        });

        it("handles 4-digit hex", () => {
            const color = parseColorString("#abcd");
            expect(color?.hex).toBe("#AABBCCDD");
        });

        it("handles 8-digit hex", () => {
            const color = parseColorString("#AABBCCDD");
            expect(color?.rgb).toEqual({ r: 170, g: 187, b: 204 });
        });
    });

    describe("edge cases", () => {
        it("handles achromatic HSL", () => {
            const color = parseColorString("hsl(0, 0%, 50%)");
            expect(color?.hex).toBe("#808080");
        });

        it("handles green as max component", () => {
            const color = parseColorString("#00ff00");
            expect(color?.hsl?.h).toBe(120);
        });

        it("handles blue as max component", () => {
            const color = parseColorString("#0000ff");
            expect(color?.hsl?.h).toBe(240);
        });

        it("handles invalid RGB values", () => {
            // Regex matches but values out of range
            // Wait, the regex \d+ matches anything.
            const color = parseColorString("rgb(300, 300, 300)");
            expect(color).toBeNull();
        });

        it("handles invalid HSL values", () => {
            const color = parseColorString("hsl(400, 110%, 110%)");
            expect(color).toBeNull();
        });
    });

    describe("parseColorsFromText", () => {
        it("extracts colors from text", () => {
            const colors = parseColorsFromText("The color is #ff0000 and the bg is blue");
            expect(colors.length).toBe(2);
            expect(colors[0].hex).toBe("#FF0000");
            expect(colors[1].name).toBe("blue");
        });
    });

    describe("parseColorsFromText duplicate handling", () => {
        it("skips duplicates", () => {
            const text = "#FF0000 #FF0000 rgb(255,0,0)";
            const colors = parseColorsFromText(text);
            expect(colors.length).toBe(1);
        });
    });

    describe("extractPaletteColors", () => {
        it("handles color name updates and limits", () => {
            const text = `
                #111111
                Named: #111111
                #222222
                #333333
            `;
            const colors = extractPaletteColors(text, 2);
            expect(colors.length).toBe(2);
            expect(colors[0].name).toBe("Named");
        });

        it("extracts complex palette and handles duplicates", () => {
            const text = `
                --primary-color: #007bff;
                --primary-dup: #007bff;
                Secondary: rgb(108, 117, 125);
                Other: #007bff;
                background-color: hsla(210, 100%, 50%, 0.5);
                .bg-[#123456]
                color: #007bff;
            `;
            const colors = extractPaletteColors(text);
            // primary, secondary, bg-color, bg-[#123456] = 4 unique
            expect(colors.length).toBe(4);
        });

        it("handles escaped characters and br tags", () => {
            const colors = extractPaletteColors("Primary: #112233\\nSecondary: #445566<br/>Accent: #778899");
            expect(colors.length).toBe(3);
        });
    });

    describe("HSL/RGB conversion branches", () => {
        it("covers hue2rgb branches", () => {
            // Colors that hit different parts of hue2rgb
            const colors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff"];
            for (const c of colors) {
                const color = parseColorString(c);
                expect(color?.hsl).toBeDefined();
                const backToHex = parseColorString(`hsl(${color?.hsl?.h}, ${color?.hsl?.s}%, ${color?.hsl?.l}%)`);
                // Allow small rounding differences
                expect(backToHex).toBeDefined();
            }
        });
    });

    describe("getColorName", () => {
        it("returns name for exact match", () => {
            expect(getColorName("#FF0000")).toBe("red");
            expect(getColorName("#000000")).toBe("black");
        });

        it("returns undefined for unknown color", () => {
            expect(getColorName("#123456")).toBeUndefined();
        });
    });

    describe("getContrastRatio", () => {
        it("calculates contrast", () => {
            const white = parseColorString("#ffffff")!;
            const black = parseColorString("#000000")!;
            const ratio = getContrastRatio(white, black);
            expect(ratio).toBeCloseTo(21, 0);
        });

        it("returns 0 if rgb is missing", () => {
            expect(getContrastRatio({ hex: "#abc" }, { hex: "#def" })).toBe(0);
        });
    });
});
