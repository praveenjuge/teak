import { describe, expect, test } from "bun:test";
import { shouldReportInvalidHydratedCard } from "../cardHydrationState";

const baseState = {
  cardId: "card-123",
  hasCardData: false,
  hydratedCard: null,
  isAuthenticated: true,
  isAuthLoading: false,
  open: true,
};

describe("connected card modal hydration", () => {
  test("keeps deep links open while authentication is loading", () => {
    expect(
      shouldReportInvalidHydratedCard({
        ...baseState,
        isAuthenticated: false,
        isAuthLoading: true,
      })
    ).toBe(false);
  });

  test("does not invalidate a card from an unauthenticated null result", () => {
    expect(
      shouldReportInvalidHydratedCard({
        ...baseState,
        isAuthenticated: false,
      })
    ).toBe(false);
  });

  test("reports a missing card after authenticated hydration completes", () => {
    expect(shouldReportInvalidHydratedCard(baseState)).toBe(true);
  });

  test("does not report a card that is loading or already available", () => {
    expect(
      shouldReportInvalidHydratedCard({
        ...baseState,
        hydratedCard: undefined,
      })
    ).toBe(false);
    expect(
      shouldReportInvalidHydratedCard({
        ...baseState,
        hasCardData: true,
      })
    ).toBe(false);
  });
});
