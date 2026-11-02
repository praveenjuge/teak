import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
  useMutation: () => mock(),
}));
mock.module("antd", () => ({
  Image: ({ src, alt, className, ...props }: any) =>
    React.createElement("img", { src, alt, className, ...props }),
}));

const { PinnedStrip } = await import("../PinnedStrip");

const card = (id: string, pinPosition: number) =>
  ({
    _id: id,
    _creationTime: 1,
    content: `Note ${id}`,
    createdAt: 1,
    pinPosition,
    type: "text",
    updatedAt: 1,
    userId: "user_1",
  }) as any;

const noop = () => undefined;

describe("PinnedStrip", () => {
  test("shows nothing without pinned cards", () => {
    expect(
      renderToStaticMarkup(
        <PinnedStrip
          cards={[]}
          onCardClick={noop}
          onReorder={noop}
          onTogglePin={noop}
        />
      )
    ).toBe("");
  });

  test("lists the pinned cards in their order, each draggable, with how to move them", () => {
    const markup = renderToStaticMarkup(
      <PinnedStrip
        cards={[card("b", 0), card("a", 1), card("c", 2)]}
        onCardClick={noop}
        onReorder={noop}
        onTogglePin={noop}
      />
    );
    expect(markup).toContain(">Pinned</h2>");
    expect(markup).toContain('aria-label="Pinned cards"');
    const order = [...markup.matchAll(/data-pinned-card-id="([^"]+)"/g)].map(
      (match) => match[1]
    );
    expect(order).toEqual(["b", "a", "c"]);
    expect(markup).not.toContain("Move pinned card");
    expect(markup).toContain("press Alt with the left or right arrow");
    // Pinned cards move in the row, so they don't start the folder drag.
    expect(markup).not.toContain('draggable="true"');
    expect(markup.match(/data-pin-mark/g)).toHaveLength(3);
  });
});
