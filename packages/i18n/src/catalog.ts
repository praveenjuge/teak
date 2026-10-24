import {
  type MessageFormatElement,
  parse,
  TYPE,
} from "@formatjs/icu-messageformat-parser";

interface Catalog {
  [key: string]: string | Catalog;
}

/** Every message in a catalog by its dotted key, such as `common.save`. */
export const flattenCatalog = (
  catalog: Catalog,
  prefix = ""
): Map<string, string> => {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      flat.set(path, value);
    } else {
      for (const [nested, message] of flattenCatalog(value, path)) {
        flat.set(nested, message);
      }
    }
  }
  return flat;
};

const KIND: Partial<Record<TYPE, string>> = {
  [TYPE.argument]: "argument",
  [TYPE.number]: "number",
  [TYPE.date]: "date",
  [TYPE.time]: "time",
  [TYPE.plural]: "plural",
  [TYPE.select]: "select",
  [TYPE.tag]: "tag",
};

const collect = (elements: MessageFormatElement[], into: Set<string>) => {
  for (const element of elements) {
    const kind = KIND[element.type];
    if (kind && "value" in element && typeof element.value === "string") {
      into.add(`${kind}:${element.value}`);
    }
    if (element.type === TYPE.tag) {
      collect(element.children, into);
    }
    if (element.type === TYPE.plural || element.type === TYPE.select) {
      for (const option of Object.values(element.options)) {
        collect(option.value, into);
      }
    }
  }
};

/**
 * What a translation must keep from English: each placeholder, plural,
 * select and tag by name and kind. Plural categories may differ, since
 * languages have their own (Japanese has only `other`). Throws when the
 * message isn't valid ICU.
 */
export const messageSignature = (message: string): string[] => {
  const names = new Set<string>();
  collect(parse(message, { ignoreTag: false }), names);
  return [...names].sort();
};
