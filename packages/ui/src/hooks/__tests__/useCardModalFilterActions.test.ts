import { describe, expect, mock, test } from "bun:test";
import { createCardModalFilterActions } from "../useCardModalFilterActions";

describe("createCardModalFilterActions", () => {
  test("applies card type filter after closing modal", () => {
    const events: string[] = [];

    const actions = createCardModalFilterActions({
      onCloseModal: () => {
        events.push("close");
      },
      addFilter: (filter) => {
        events.push(`filter:${filter}`);
      },
      addKeywordTag: (_keyword) => {},
    });

    actions.handleCardTypeClick("image");

    expect(events).toEqual(["close", "filter:image"]);
  });

  test("applies keyword tag after closing modal", () => {
    const events: string[] = [];

    const actions = createCardModalFilterActions({
      onCloseModal: () => {
        events.push("close");
      },
      addFilter: (_filter) => {},
      addKeywordTag: (keyword) => {
        events.push(`tag:${keyword}`);
      },
    });

    actions.handleTagClick("design");

    expect(events).toEqual(["close", "tag:design"]);
  });

  test("passes through callback values", () => {
    const onCloseModal = mock(() => {});
    const addFilter = mock((_filter: string) => {});
    const addKeywordTag = mock((_keyword: string) => {});

    const actions = createCardModalFilterActions({
      onCloseModal,
      addFilter: addFilter as never,
      addKeywordTag,
    });

    actions.handleCardTypeClick("link");
    actions.handleTagClick("notes");

    expect(onCloseModal).toHaveBeenCalledTimes(2);
    expect(addFilter).toHaveBeenCalledWith("link");
    expect(addKeywordTag).toHaveBeenCalledWith("notes");
  });
});
