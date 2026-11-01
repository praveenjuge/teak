import { describe, expect, test } from "bun:test";
import { markdownManager, prepareMarkdownDocument } from "../markdownDocument";
import { extractLinkList } from "../noteCapture";

const urls = (count: number, prefix = "https://example.com/paste") =>
  Array.from({ length: count }, (_, index) => `${prefix}/${index + 1}`);

const pasted = (text: string) =>
  markdownManager.serialize(prepareMarkdownDocument(text).document);

const TWELVE = [
  ...urls(10, "https://example.com/paste-links"),
  "https://example.com/new/1",
  "https://example.com/new/2",
];
const ODD_CHARACTERS = [
  "https://en.wikipedia.org/wiki/Teak_(wood)",
  "https://example.com/snake_case_path/_leading",
  "https://example.com/stars*and*more",
  "https://example.com/search?q=a&b=c",
];
const IDN = ["https://bücher.example/straße", "https://例え.テスト/パス"];

const LISTS: [name: string, text: string, links: string[]][] = [
  [
    "two links",
    "https://example.com/a\nhttps://example.com/b",
    ["https://example.com/a", "https://example.com/b"],
  ],
  [
    "12 links in a bulleted list",
    TWELVE.map((url) => `- ${url}`).join("\n"),
    TWELVE,
  ],
  ["100 links", urls(100).join("\n"), urls(100)],
  ["140 links", urls(140).join("\n"), urls(140)],
  ["links with _ ) * and &", ODD_CHARACTERS.join("\n"), ODD_CHARACTERS],
  ["IDN links", IDN.join("\n"), IDN],
  [
    "links with blank lines between them",
    "https://example.com/a\n\n\nhttps://example.com/b\n\nhttps://example.com/c\n",
    ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
  ],
  [
    "the same link three times",
    "https://example.com/same\nhttps://example.com/same\nhttps://example.com/same",
    [
      "https://example.com/same",
      "https://example.com/same",
      "https://example.com/same",
    ],
  ],
  [
    "a numbered list",
    "1. https://example.com/a\n2. https://example.com/b",
    ["https://example.com/a", "https://example.com/b"],
  ],
  [
    "a list with * and + markers",
    "* https://example.com/a\n* https://example.com/b\n\n+ https://example.com/c",
    ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
  ],
];

describe("extractLinkList", () => {
  test.each(LISTS)("splits %s into one link each", (_name, text, links) => {
    expect(extractLinkList(text)).toEqual(links);
  });

  test.each(LISTS)(
    "splits %s the same once pasted into the editor",
    (_name, text, links) => {
      expect(extractLinkList(pasted(text))).toEqual(links);
    }
  );

  test.each([
    [
      "links showing their own address",
      "[https://example.com/a](https://example.com/a)\n\n[https://example.com/b_c](https://example.com/b_c)",
      ["https://example.com/a", "https://example.com/b_c"],
    ],
    [
      "autolinks",
      "<https://example.com/a>\n<https://example.com/b>",
      ["https://example.com/a", "https://example.com/b"],
    ],
    [
      "escaped characters",
      "https://example.com/a\\_b\\_c\nhttps://example.com/\\(x\\)",
      ["https://example.com/a_b_c", "https://example.com/(x)"],
    ],
    [
      "an encoded ampersand",
      "https://example.com/?a=1&amp;b=2\nhttps://example.com/b",
      ["https://example.com/?a=1&b=2", "https://example.com/b"],
    ],
    [
      "hard breaks",
      "https://example.com/a  \nhttps://example.com/b\\\nhttps://example.com/c",
      [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
      ],
    ],
    [
      "a loose list",
      "- https://example.com/a\n\n- https://example.com/b",
      ["https://example.com/a", "https://example.com/b"],
    ],
    [
      "a nested list",
      "- https://example.com/a\n  - https://example.com/b",
      ["https://example.com/a", "https://example.com/b"],
    ],
  ])("reads %s", (_name, text, links) => {
    expect(extractLinkList(text)).toEqual(links);
  });

  test.each([
    ["an empty draft", ""],
    ["one link", "https://example.com/a"],
    ["one link in a list", "- https://example.com/a"],
    ["prose", "Read these later\nwhen there is time"],
    [
      "a link with words after it",
      "https://example.com/a\nhttps://example.com/b is great\nhttps://example.com/c",
    ],
    ["two links on one line", "https://example.com/a https://example.com/b"],
    [
      "a heading over links",
      "# Reading\nhttps://example.com/a\nhttps://example.com/b",
    ],
    [
      "a code block of links",
      "```\nhttps://example.com/a\nhttps://example.com/b\n```",
    ],
    [
      "an indented code block of links",
      "    https://example.com/a\n    https://example.com/b",
    ],
    ["a quote of links", "> https://example.com/a\n> https://example.com/b"],
    ["a javascript: line", "https://example.com/a\njavascript:alert(1)"],
    [
      "a javascript: link",
      "https://example.com/a\n[javascript:alert(1)](javascript:alert(1))",
    ],
    ["a www address", "https://example.com/a\nwww.example.com"],
    ["a mail address", "https://example.com/a\nhello@example.com"],
    ["an ftp link", "https://example.com/a\nftp://example.com/file"],
    [
      "authored links",
      "[Article](https://example.com/a)\n[Other](https://example.com/b)",
    ],
    [
      "a link labelled with another address",
      "[https://example.com/a](https://example.com/evil)\nhttps://example.com/b",
    ],
    ["a bold link", "**https://example.com/a**\nhttps://example.com/b"],
    [
      "a checklist of links",
      "- [ ] https://example.com/a\n- [ ] https://example.com/b",
    ],
  ])("leaves %s as a note", (_name, text) => {
    expect(extractLinkList(text)).toBeNull();
    expect(extractLinkList(pasted(text))).toBeNull();
  });
});
