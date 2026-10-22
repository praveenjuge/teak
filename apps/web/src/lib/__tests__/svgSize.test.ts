import { describe, expect, test } from "bun:test";
import { sizeSvgRoot } from "../svgSize";

const rootTag = (svg: string) => svg.match(/<svg\b[^>]*>/)?.[0] ?? "";
const attributeValues = (tag: string, name: string) =>
  [...tag.matchAll(new RegExp(`\\s${name}="([^"]*)"`, "g"))].map(
    (match) => match[1]
  );

describe("sizeSvgRoot", () => {
  test("adds width and height to an SVG that has neither", () => {
    const tag = rootTag(
      sizeSvgRoot('<svg viewBox="0 0 24 16"><path d="M0 0"/></svg>', 24, 16)
    );
    expect(attributeValues(tag, "width")).toEqual(["24"]);
    expect(attributeValues(tag, "height")).toEqual(["16"]);
  });

  test("keeps an SVG's own pixel width and height without repeating them", () => {
    const tag = rootTag(
      sizeSvgRoot(
        '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32" viewBox="0 0 24 16"></svg>',
        24,
        16
      )
    );
    expect(attributeValues(tag, "width")).toEqual(["48"]);
    expect(attributeValues(tag, "height")).toEqual(["32"]);
  });

  test("adds only the dimension that is missing", () => {
    const tag = rootTag(
      sizeSvgRoot('<svg width="48" viewBox="0 0 24 16"></svg>', 24, 16)
    );
    expect(attributeValues(tag, "width")).toEqual(["48"]);
    expect(attributeValues(tag, "height")).toEqual(["16"]);
  });

  test("replaces relative sizes that give the image no pixel size", () => {
    const tag = rootTag(
      sizeSvgRoot(
        '<svg width="100%" height="1em" viewBox="0 0 24 16"></svg>',
        24,
        16
      )
    );
    expect(attributeValues(tag, "width")).toEqual(["24"]);
    expect(attributeValues(tag, "height")).toEqual(["16"]);
  });

  test("ignores stroke-width and sizes on child elements", () => {
    const svg = sizeSvgRoot(
      '<svg stroke-width="2" viewBox="0 0 24 16"><rect width="5" height="5"/></svg>',
      24,
      16
    );
    const tag = rootTag(svg);
    expect(attributeValues(tag, "width")).toEqual(["24"]);
    expect(attributeValues(tag, "height")).toEqual(["16"]);
    expect(tag).toContain('stroke-width="2"');
    expect(svg).toContain('<rect width="5" height="5"/>');
  });

  test("never repeats an attribute on the root element, which would make the SVG invalid XML", () => {
    const svg = sizeSvgRoot(
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"></svg>',
      24,
      16
    );
    // A repeated attribute is a well-formedness error in XML.
    const names = [...rootTag(svg).matchAll(/\s([\w:-]+)=/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
  });
});
