import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCENARIOS } from "../../packages/convex/devSeed/scenarios";

const GUIDE = join(
  import.meta.dir,
  "../../apps/docs/content/docs/(open-source)/adding-a-feature.mdx"
);

/** Splits the list at its top-level separators, outside any parentheses. */
const listItems = (list: string): string[] => {
  const items: string[] = [];
  let depth = 0;
  let item = "";
  for (let index = 0; index < list.length; index += 1) {
    const char = list[index];
    depth += char === "(" ? 1 : 0;
    depth -= char === ")" ? 1 : 0;
    if (depth === 0 && list.startsWith(". ", index)) {
      break;
    }
    if (depth === 0 && list.startsWith(", ", index)) {
      items.push(item);
      item = "";
      index += 1;
      continue;
    }
    if (depth === 0 && list.startsWith(" and `", index)) {
      items.push(item);
      item = "";
      index += " and".length;
      continue;
    }
    item += char;
  }
  return [...items, item];
};

/** The pack names the guide's "Packs:" sentence lists, in backticks. */
export const documentedPacks = (markdown: string): string[] => {
  const line = markdown.split("\n").find((text) => text.startsWith("Packs: "));
  if (!line) {
    return [];
  }
  // A pack's name is the first backticked word of each item; the notes in
  // parentheses after it can name other things in backticks.
  return listItems(line.slice("Packs: ".length)).flatMap((item) => {
    const name = item.match(/`([a-z0-9-]+)`/)?.[1];
    return name ? [name] : [];
  });
};

describe("the seed pack list in adding-a-feature.mdx", () => {
  test("names every pack devSeed:seedScenario has, once each", () => {
    const documented = documentedPacks(readFileSync(GUIDE, "utf8"));
    expect([...documented].sort()).toEqual(
      SCENARIOS.map((pack) => pack.name).sort()
    );
  });

  test("reads each item's first name, not the names in its notes or the next sentence", () => {
    expect(
      documentedPacks(
        "Packs: `a`, `b-c` (with `x` and `y`, then `z.md`), `d` and `e` (more). `f` is big.\nPacks: `g`"
      )
    ).toEqual(["a", "b-c", "d", "e"]);
  });
});
