import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const {
  cardModalFrameClass,
  isShortNote,
  SHORT_NOTE_MAX_CHARS,
  useCardModalFrameClass,
} = await import("../cardModalFrame");

const NOTE_FRAME = "md:w-[min(56rem,calc(100vw-8rem))]";
const READING_FRAME = "md:w-[min(72rem,calc(100vw-8rem))]";

describe("the card dialog's size", () => {
  test("fits a short note in a smaller frame", () => {
    const card = { content: "Gift ideas: a fountain pen.", type: "text" };
    expect(isShortNote(card)).toBe(true);
    expect(cardModalFrameClass(card)).toContain(NOTE_FRAME);
  });

  test("gives a long note the reading frame", () => {
    const long = {
      content: "a".repeat(SHORT_NOTE_MAX_CHARS + 1),
      type: "text",
    };
    const manyLines = {
      content: "one\ntwo\nthree\nfour\nfive\nsix\nseven",
      type: "text",
    };
    for (const card of [long, manyLines]) {
      expect(isShortNote(card)).toBe(false);
      expect(cardModalFrameClass(card)).toContain(READING_FRAME);
    }
  });

  test("leaves other kinds of card as they were", () => {
    expect(isShortNote({ content: "Less, but better.", type: "quote" })).toBe(
      false
    );
    expect(cardModalFrameClass({ type: "link" })).toContain(
      "md:w-[min(82rem,calc(100vw-8rem))]"
    );
  });
});

describe("a short note being edited", () => {
  let root: ReturnType<typeof createRoot> | undefined;
  afterEach(async () => {
    await act(() => root?.unmount());
    root = undefined;
  });

  test("keeps its frame as it grows, until another card opens", async () => {
    let frame = "";
    function Harness({
      card,
    }: {
      card: { _id: string; content: string; type: string };
    }) {
      frame = useCardModalFrameClass(card);
      return null;
    }
    root = createRoot(document.createElement("div"));
    const render = (card: { _id: string; content: string; type: string }) =>
      act(() => root?.render(<Harness card={card} />));

    await render({ _id: "a", content: "Short", type: "text" });
    expect(frame).toContain(NOTE_FRAME);
    await render({ _id: "a", content: "Short".repeat(100), type: "text" });
    expect(frame).toContain(NOTE_FRAME);

    await render({ _id: "b", content: "Long".repeat(100), type: "text" });
    expect(frame).toContain(READING_FRAME);
    await render({ _id: "c", content: "Short again", type: "text" });
    expect(frame).toContain(NOTE_FRAME);
  });
});
