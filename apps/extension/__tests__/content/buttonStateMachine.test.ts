// @ts-nocheck
import { describe, expect, test } from "bun:test";
import {
  mapSaveResponseToButtonState,
  shouldAllowClick,
} from "../../entrypoints/content/buttonStateMachine";

describe("inline button state machine", () => {
  test("prevents click while saving", () => {
    expect(shouldAllowClick("saving")).toBe(false);
  });

  test("prevents click after saved", () => {
    expect(shouldAllowClick("saved")).toBe(false);
  });

  test("allows click after error for retry", () => {
    expect(shouldAllowClick("error")).toBe(true);
  });

  test("maps saved response to saved state", () => {
    const state = mapSaveResponseToButtonState({
      status: "saved",
      cardId: "card_1",
    });

    expect(state).toBe("saved");
  });

  test("maps duplicate response to duplicate state", () => {
    const state = mapSaveResponseToButtonState({
      status: "duplicate",
      cardId: "card_1",
    });

    expect(state).toBe("duplicate");
  });

  test("maps errors to error state", () => {
    const state = mapSaveResponseToButtonState({
      status: "error",
      message: "network issue",
    });

    expect(state).toBe("error");
  });
});
