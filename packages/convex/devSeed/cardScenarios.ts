import type { DevScenarioCardDef } from "../card/defaultCards";
import { bylineLink, SCENARIO_MARKER } from "./helpers";

export const CARD_DETAILS_SCENARIO_CARDS: DevScenarioCardDef[] = [
  bylineLink("full", "https://www.theverge.com/2024/3/5/teak-byline", {
    title: "A full byline whose publisher repeats the site",
    description: "Author, publisher and date; the publisher names the host.",
    author: "Nilay Patel",
    publisher: "The Verge",
    publishedAt: "2024-03-05T10:00:00Z",
  }),
  bylineLink("publisher", "https://www.nytimes.com/2023/11/20/teak.html", {
    title: "Author, a distinct publisher and a date",
    author: "Jane Doe",
    publisher: "The New York Times",
    publishedAt: "2023-11-20",
  }),
  bylineLink("author-only", "https://paulgraham.com/teak.html", {
    title: "Only an author, who is also the publisher",
    author: "Paul Graham",
    publisher: "paul graham",
  }),
  bylineLink("date-only", "https://blog.example.com/teak-date-only", {
    title: "Only a publish date with a time zone offset",
    publishedAt: "2025-12-31T23:30:00-05:00",
  }),
  bylineLink("garbage", "https://medium.com/@someone/teak-garbage", {
    title: "An author that is a profile URL and a garbage date",
    author: "https://www.facebook.com/someauthor",
    publishedAt: "sometime last week",
  }),
  bylineLink("long", "https://longreads.example.org/teak-long", {
    title:
      "A very long byline that must truncate in the preview without breaking the layout of the card modal at any width",
    author: `Dr. ${"Bartholomew Montgomery-Fitzgerald ".repeat(8).trim()}`,
    publisher: `The ${"Extraordinarily Verbose ".repeat(6).trim()} Quarterly`,
    publishedAt: "2022-06-01",
  }),
  bylineLink("rtl-cjk", "https://www.aljazeera.net/teak-rtl", {
    title: "مقال عن الأفكار — 東京のアイデア",
    author: "山田太郎",
    publisher: "مجلة العربي",
    publishedAt: "2021-02-14",
  }),
  bylineLink("unicode-host", "https://bücher.example/teak-unicode", {
    title: "A unicode host with an umlaut author",
    author: "Jürgen Müller",
    publishedAt: "2020-07-04",
  }),
  bylineLink(
    "no-metadata",
    "https://unreachable.example.net/teak-none",
    { status: "error" },
    { metadataTitle: "A link whose preview failed" }
  ),
  bylineLink(
    "trashed",
    "https://www.theguardian.com/teak-trashed",
    {
      title: "A trashed link with a byline",
      author: "Ada Lovelace",
      publisher: "The Guardian",
      publishedAt: "2019-10-10",
    },
    { isDeleted: true }
  ),
];

export const LONG_SCENARIO_TAG = `long-${"x".repeat(59)}`;

const tagsCaseCard = (
  slug: string,
  label: string,
  extra: Partial<DevScenarioCardDef>
): DevScenarioCardDef => {
  const url = `https://example.com/tags-case/${slug}#${SCENARIO_MARKER}-tags-case`;
  return {
    type: "link",
    content: url,
    url,
    metadataTitle: label,
    ...extra,
  };
};

export const TAGS_CASE_SCENARIO_CARDS: DevScenarioCardDef[] = [
  tagsCaseCard("upper-first", "Design (user tag)", { tags: ["Design", "web"] }),
  tagsCaseCard("lower", "design (user tag)", { tags: ["design", "ui"] }),
  tagsCaseCard("caps", "DESIGN (user tag)", { tags: ["DESIGN"] }),
  tagsCaseCard("ai", "design (AI tag)", { aiTags: ["design", "Moodboard"] }),
  tagsCaseCard("both", "Design user + design AI", {
    tags: ["Design"],
    aiTags: ["design"],
  }),
  tagsCaseCard("archived", "Design, archived", {
    tags: ["Design"],
    isArchived: true,
  }),
  tagsCaseCard("trashed", "DESIGN, in Trash", {
    tags: ["DESIGN"],
    isDeleted: true,
  }),
  tagsCaseCard("emoji", "Emoji tags", { tags: ["🎨 art", "✨"] }),
  tagsCaseCard("rtl", "Right-to-left tag", { tags: ["تصميم", "עיצוב"] }),
  tagsCaseCard("cjk", "CJK tags", { tags: ["设计", "デザイン", "디자인"] }),
  tagsCaseCard("long", "64-character tag", { tags: [LONG_SCENARIO_TAG] }),
];
