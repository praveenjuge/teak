import {
  type MessageFormatElement,
  parse,
  TYPE,
} from "@formatjs/icu-messageformat-parser";
import { printAST } from "@formatjs/icu-messageformat-parser/printer.js";

const ACCENTED: Record<string, string> = {
  a: "á",
  b: "ƀ",
  c: "ç",
  d: "ð",
  e: "é",
  f: "ƒ",
  g: "ĝ",
  h: "ĥ",
  i: "î",
  j: "ĵ",
  k: "ķ",
  l: "ļ",
  n: "ñ",
  o: "ö",
  p: "þ",
  r: "ŕ",
  s: "š",
  t: "ţ",
  u: "û",
  w: "ŵ",
  y: "ý",
  z: "ž",
  A: "Å",
  C: "Ç",
  D: "Ð",
  E: "É",
  G: "Ĝ",
  I: "Î",
  L: "Ļ",
  N: "Ñ",
  O: "Ö",
  S: "Š",
  T: "Ţ",
  U: "Û",
  Y: "Ý",
};

const accent = (text: string) =>
  Array.from(text, (character) => ACCENTED[character] ?? character).join("");

const pseudoElements = (
  elements: MessageFormatElement[]
): MessageFormatElement[] =>
  elements.map((element) => {
    if (element.type === TYPE.literal) {
      return { ...element, value: accent(element.value) };
    }
    if (element.type === TYPE.tag) {
      return { ...element, children: pseudoElements(element.children) };
    }
    if (element.type === TYPE.plural || element.type === TYPE.select) {
      return {
        ...element,
        options: Object.fromEntries(
          Object.entries(element.options).map(([key, option]) => [
            key,
            { ...option, value: pseudoElements(option.value) },
          ])
        ),
      };
    }
    return element;
  });

const visibleLength = (elements: MessageFormatElement[]): number =>
  elements.reduce((length, element) => {
    if (element.type === TYPE.literal) {
      return length + element.value.length;
    }
    if (element.type === TYPE.tag) {
      return length + visibleLength(element.children);
    }
    if (element.type === TYPE.plural || element.type === TYPE.select) {
      const branch = element.options.other ?? Object.values(element.options)[0];
      return length + (branch ? visibleLength(branch.value) : 0);
    }
    return length;
  }, 0);

/**
 * One message in the pseudo-locale: letters accented, about 40% longer, and
 * wrapped in brackets, so text that skipped the catalog stands out.
 * Placeholders, plurals and tags keep working.
 */
export const pseudoLocalize = (message: string): string => {
  const ast = parse(message, { ignoreTag: false });
  const printed = printAST(pseudoElements(ast));
  const padding = "~".repeat(Math.max(1, Math.round(visibleLength(ast) * 0.4)));
  return `[${printed} ${padding}]`;
};

interface Catalog {
  [key: string]: string | Catalog;
}

export const pseudoLocalizeMessages = <T extends Catalog>(messages: T): T =>
  Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [
      key,
      typeof value === "string"
        ? pseudoLocalize(value)
        : pseudoLocalizeMessages(value),
    ])
  ) as T;
