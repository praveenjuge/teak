import { describe, expect, mock, test } from "bun:test";
import { normalizeCardQueryId } from "../useCardQueryParamState";

function runCardQueryAction(options: {
  action: "open" | "close";
  candidateId?: string;
  currentCardId: string | null;
}) {
  const pushCardId = mock((_cardId: string) => {});
  const replaceCardId = mock((_cardId: string | null) => {});
  let selectedCardId = normalizeCardQueryId(options.currentCardId);

  const openCard = (cardId: string) => {
    const nextCardId = normalizeCardQueryId(cardId);
    if (!nextCardId || selectedCardId === nextCardId) {
      return;
    }

    selectedCardId = nextCardId;
    pushCardId(nextCardId);
  };

  const closeCard = () => {
    if (selectedCardId === null) {
      return;
    }

    selectedCardId = null;
    replaceCardId(null);
  };

  if (options.action === "open") {
    openCard(options.candidateId ?? "");
  } else {
    closeCard();
  }

  return {
    selectedCardId,
    pushCardId,
    replaceCardId,
  };
}

describe("useCardQueryParamState helpers", () => {
  test("open pushes url and updates selected card", () => {
    const result = runCardQueryAction({
      action: "open",
      candidateId: "abc123",
      currentCardId: null,
    });

    expect(result.selectedCardId).toBe("abc123");
    expect(result.pushCardId).toHaveBeenCalledTimes(1);
    expect(result.pushCardId).toHaveBeenCalledWith("abc123");
    expect(result.replaceCardId).not.toHaveBeenCalled();
  });

  test("close replaces url and clears selected card", () => {
    const result = runCardQueryAction({
      action: "close",
      currentCardId: "abc123",
    });

    expect(result.selectedCardId).toBeNull();
    expect(result.replaceCardId).toHaveBeenCalledTimes(1);
    expect(result.replaceCardId).toHaveBeenCalledWith(null);
    expect(result.pushCardId).not.toHaveBeenCalled();
  });

  test("open is a no-op when card id is already selected", () => {
    const result = runCardQueryAction({
      action: "open",
      candidateId: "abc123",
      currentCardId: "abc123",
    });

    expect(result.selectedCardId).toBe("abc123");
    expect(result.pushCardId).not.toHaveBeenCalled();
    expect(result.replaceCardId).not.toHaveBeenCalled();
  });

  test("invalid or empty card ids are ignored", () => {
    const result = runCardQueryAction({
      action: "open",
      candidateId: "   ",
      currentCardId: null,
    });

    expect(result.selectedCardId).toBeNull();
    expect(result.pushCardId).not.toHaveBeenCalled();
    expect(result.replaceCardId).not.toHaveBeenCalled();
  });
});
