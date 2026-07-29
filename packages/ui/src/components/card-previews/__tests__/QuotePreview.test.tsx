import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@teak/ui/components/ui/textarea", () => ({
  Textarea: ({
    value,
    placeholder,
    className,
    ...props
  }: Record<string, unknown>) =>
    React.createElement("textarea", {
      className,
      placeholder,
      value,
      readOnly: true,
      ...props,
    }),
}));

const { QuotePreview } = await import("../QuotePreview");

const createQuoteCard = (overrides?: Record<string, unknown>) => ({
  _id: "card_quote",
  _creationTime: Date.now(),
  content: "Be curious.",
  createdAt: Date.now(),
  isDeleted: false,
  isFavorited: false,
  type: "quote",
  updatedAt: Date.now(),
  userId: "user_123",
  ...overrides,
});

describe("QuotePreview", () => {
  test("renders decorative quotes around the editable body", () => {
    const markup = renderToStaticMarkup(
      <QuotePreview
        card={createQuoteCard() as any}
        onContentChange={() => undefined}
      />
    );

    expect(markup).toContain("“");
    expect(markup).toContain("”");
    expect(markup).toContain("Be curious.");
    expect(markup).toContain('placeholder="Enter your quote..."');
  });

  test("prefers getCurrentValue over the stored card content", () => {
    const markup = renderToStaticMarkup(
      <QuotePreview
        card={createQuoteCard({ content: "stale" }) as any}
        getCurrentValue={() => "fresh draft"}
        onContentChange={() => undefined}
      />
    );

    expect(markup).toContain("fresh draft");
    expect(markup).not.toContain("stale");
  });
});
