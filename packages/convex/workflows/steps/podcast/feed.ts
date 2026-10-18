import { Parser } from "htmlparser2";

// A podcast's RSS 2.0 or Atom feed, read only for its episodes' titles,
// links and audio files (`<enclosure>`, or Atom's `<link rel="enclosure">`).

/** A feed of 5,000 episodes is about 2 MiB; anything past that is dropped. */
export const MAX_FEED_ITEMS = 5000;

export interface FeedItem {
  enclosureLength?: number;
  enclosureType?: string;
  enclosureUrl?: string;
  guid?: string;
  link?: string;
  title?: string;
}

const ITEM_TAGS = new Set(["item", "entry"]);

const positiveInteger = (value: string | undefined): number | undefined => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

/** A feed's items in order. Never throws; a malformed feed gives what it read. */
export const parseFeed = (xml: string): FeedItem[] => {
  const items: FeedItem[] = [];
  const stack: string[] = [];
  let item: FeedItem | null = null;
  let text = "";

  const parser = new Parser(
    {
      onopentag(rawName, attributes) {
        const name = rawName.toLowerCase();
        const parent = stack[stack.length - 1];
        stack.push(name);
        text = "";
        if (ITEM_TAGS.has(name)) {
          item = items.length < MAX_FEED_ITEMS ? {} : null;
          return;
        }
        if (!(item && parent && ITEM_TAGS.has(parent))) {
          return;
        }
        if (name === "enclosure" && attributes.url) {
          item.enclosureUrl ??= attributes.url;
          item.enclosureType ??= attributes.type || undefined;
          item.enclosureLength ??= positiveInteger(attributes.length);
        } else if (name === "link" && attributes.href) {
          // Atom: the episode page, or its audio as rel="enclosure".
          const rel = (attributes.rel || "alternate").toLowerCase();
          if (rel === "enclosure") {
            item.enclosureUrl ??= attributes.href;
            item.enclosureType ??= attributes.type || undefined;
            item.enclosureLength ??= positiveInteger(attributes.length);
          } else if (rel === "alternate") {
            item.link ??= attributes.href;
          }
        }
      },
      ontext(chunk) {
        if (item) {
          text += chunk;
        }
      },
      onclosetag(rawName) {
        const name = rawName.toLowerCase();
        stack.pop();
        const parent = stack[stack.length - 1];
        const current: FeedItem | null = item;
        if (ITEM_TAGS.has(name)) {
          if (current) {
            items.push(current);
          }
          item = null;
        } else if (current && parent && ITEM_TAGS.has(parent)) {
          const value = text.trim();
          if (value) {
            if (name === "title") {
              current.title ??= value;
            } else if (name === "link") {
              current.link ??= value;
            } else if (name === "guid" || name === "id") {
              current.guid ??= value;
            }
          }
        }
        text = "";
      },
    },
    { decodeEntities: true, xmlMode: true }
  );
  parser.write(xml);
  parser.end();
  return items;
};
