import { describe, expect, mock, test } from "bun:test";
import { qualifierChipsFromText } from "../../lib/cardsSearchState";
import {
  createCardModalFilterActions,
  tagQualifier,
} from "../useCardModalFilterActions";

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
      addQualifier: (_qualifier) => undefined,
    });

    actions.handleCardTypeClick("image");

    expect(events).toEqual(["close", "filter:image"]);
  });

  test("a tag chip closes the card and filters by that tag", () => {
    const events: string[] = [];

    const actions = createCardModalFilterActions({
      onCloseModal: () => {
        events.push("close");
      },
      addFilter: (_filter) => undefined,
      addQualifier: (qualifier) => {
        events.push(qualifier);
      },
    });

    actions.handleTagClick("design");

    expect(events).toEqual(["close", "tag:design"]);
  });

  test("a tag with spaces and emoji becomes one quoted tag filter, as typed", () => {
    const addQualifier = mock((_qualifier: string) => undefined);
    const actions = createCardModalFilterActions({
      onCloseModal: () => undefined,
      addFilter: (_filter) => undefined,
      addQualifier,
    });

    actions.handleTagClick("verify tag 🎉 with spaces");

    expect(addQualifier).toHaveBeenCalledWith(
      'tag:"verify tag 🎉 with spaces"'
    );
    expect(qualifierChipsFromText('tag:"verify tag 🎉 with spaces"')).toEqual([
      tagQualifier("verify tag 🎉 with spaces"),
    ]);
  });

  test("a blank tag does nothing", () => {
    const onCloseModal = mock(() => undefined);
    const addQualifier = mock((_qualifier: string) => undefined);
    createCardModalFilterActions({
      onCloseModal,
      addFilter: (_filter) => undefined,
      addQualifier,
    }).handleTagClick("  ");

    expect(onCloseModal).not.toHaveBeenCalled();
    expect(addQualifier).not.toHaveBeenCalled();
  });
});
