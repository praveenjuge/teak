import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PageArchiveRow, pageArchiveRowState } from "../PageArchiveRow";
import type { CardModalCard } from "../types";

const ARCHIVE = {
  bytes: 2.4 * 1024 * 1024,
  capturedAt: 1,
  kind: "full" as const,
  source: "server" as const,
  sourceUrl: "https://example.com/post",
  storageKey: "users/u/cards/c/page-archive/r1-archive.html",
};

const link = (fields: Partial<CardModalCard> = {}) =>
  ({
    _creationTime: 0,
    _id: "card_1",
    content: "https://example.com/post",
    createdAt: 0,
    type: "link",
    updatedAt: 0,
    url: "https://example.com/post",
    userId: "user_1",
    ...fields,
  }) as unknown as CardModalCard;

const render = (card: CardModalCard) =>
  renderToStaticMarkup(
    <dl>
      <PageArchiveRow card={card} />
    </dl>
  );

const text = (html: string) =>
  html
    .replace(/<[^>]+>/gu, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/gu, " ")
    .trim();

describe("PageArchiveRow", () => {
  test("a saved copy shows its size", () => {
    expect(text(render(link({ pageArchive: ARCHIVE })))).toBe(
      "Archived copy 2.4 MB"
    );
  });

  test("a text-only copy says so", () => {
    expect(
      text(render(link({ pageArchive: { ...ARCHIVE, kind: "text_only" } })))
    ).toBe("Archived copy Text only");
  });

  test.each(["pending", "in_progress"] as const)(
    "a copy %s says it is saving, with a skeleton bar",
    (status) => {
      const html = render(link({ processingStatus: { archive: { status } } }));
      expect(text(html)).toBe("Archived copy Saving a copy…");
      expect(html).toContain('data-slot="skeleton"');
    }
  );

  test("a refresh keeps showing the copy it has", () => {
    expect(
      text(
        render(
          link({
            pageArchive: ARCHIVE,
            processingStatus: { archive: { status: "in_progress" } },
          })
        )
      )
    ).toBe("Archived copy 2.4 MB");
  });

  test.each([
    ["blocked_url", "Teak can't open this page"],
    ["too_large", "The page is too large to save"],
    ["not_html", "The link isn't a web page"],
    ["http_error", "The page couldn't be reached"],
    ["workflow_failed", "The page couldn't be reached"],
  ])("a copy that failed with %s explains why", (error, reason) => {
    const html = render(
      link({ processingStatus: { archive: { error, status: "failed" } } })
    );
    expect(text(html)).toBe("Archived copy Couldn't save a copy");
    expect(html).toContain(`aria-label="${reason.replaceAll("'", "&#x27;")}"`);
  });

  test("other cards, and links never archived, have no row", () => {
    expect(
      pageArchiveRowState({
        processingStatus: undefined,
        type: "text",
      } as never)
    ).toBeNull();
    expect(render(link())).toBe("<dl></dl>");
  });
});
