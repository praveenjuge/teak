// @ts-nocheck
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createCardActions,
  setSentryCaptureFunction,
} from "../../../client/hooks/useCardActions.client";

describe("defaults", () => {
  test("uses default sentry capture without error", async () => {
    const _actions = createCardActions({
      updateCardField: mock(),
      permanentDeleteCard: mock(),
    });
    // Trigger error
    const mockUpdate = mock().mockRejectedValue(new Error("fail"));
    const actions2 = createCardActions({
      updateCardField: mockUpdate,
      permanentDeleteCard: mock(),
    });
    await actions2.handleDeleteCard("c1" as any);
    // Should catch and call default captureException
  });
});

describe("createCardActions", () => {
  const mockPermanentDeleteCard = mock();
  const mockUpdateCardField = mock();
  const mockOnDeleteSuccess = mock();
  const mockOnRestoreSuccess = mock();
  const mockOnPermanentDeleteSuccess = mock();
  const mockOnError = mock();
  const mockSentryCapture = mock();

  const dependencies = {
    permanentDeleteCard: mockPermanentDeleteCard,
    updateCardField: mockUpdateCardField,
  };
  const config = {
    onDeleteSuccess: mockOnDeleteSuccess,
    onRestoreSuccess: mockOnRestoreSuccess,
    onPermanentDeleteSuccess: mockOnPermanentDeleteSuccess,
    onError: mockOnError,
  };

  beforeEach(() => {
    mockPermanentDeleteCard.mockReset();
    mockUpdateCardField.mockReset();
    mockOnDeleteSuccess.mockReset();
    mockOnRestoreSuccess.mockReset();
    mockOnPermanentDeleteSuccess.mockReset();
    mockOnError.mockReset();
    mockSentryCapture.mockReset();
    setSentryCaptureFunction(mockSentryCapture);
  });

  afterEach(() => {
    // Clear all mocks after each test
    mockPermanentDeleteCard.mockReset();
    mockUpdateCardField.mockReset();
  });

  const actions = createCardActions(dependencies, config);

  describe("initialization", () => {
    test("creates actions object with all methods", () => {
      expect(actions).toBeDefined();
      expect(typeof actions.handleDeleteCard).toBe("function");
      expect(typeof actions.handleBulkDeleteCards).toBe("function");
      expect(typeof actions.handleRestoreCard).toBe("function");
      expect(typeof actions.handlePermanentDeleteCard).toBe("function");
      expect(typeof actions.handleToggleFavorite).toBe("function");
      expect(typeof actions.updateField).toBe("function");
    });

    test("works without optional config", () => {
      const minimalActions = createCardActions(dependencies);
      expect(minimalActions).toBeDefined();
      expect(typeof minimalActions.handleDeleteCard).toBe("function");
    });

    test("works with empty config", () => {
      const emptyConfigActions = createCardActions(dependencies, {});
      expect(emptyConfigActions).toBeDefined();
    });
  });

  describe("handleDeleteCard", () => {
    test("calls updateCardField with delete field", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      await actions.handleDeleteCard("c1" as any);
      expect(mockUpdateCardField).toHaveBeenCalledWith({
        cardId: "c1",
        field: "delete",
      });
    });

    test("calls onDeleteSuccess callback with message", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      await actions.handleDeleteCard("c1" as any);
      expect(mockOnDeleteSuccess).toHaveBeenCalledWith(
        "Card deleted. Find it by searching 'trash'"
      );
    });

    test("does not call onDeleteSuccess on error", async () => {
      const error = new Error("fail");
      mockUpdateCardField.mockRejectedValue(error);
      await actions.handleDeleteCard("c1" as any);
      expect(mockOnDeleteSuccess).not.toHaveBeenCalled();
    });

    test("calls onError callback with error and operation", async () => {
      const error = new Error("fail");
      mockUpdateCardField.mockRejectedValue(error);
      await actions.handleDeleteCard("c1" as any);
      expect(mockOnError).toHaveBeenCalledWith(error, "delete");
    });

    test("captures exception in Sentry on error", async () => {
      const error = new Error("fail");
      mockUpdateCardField.mockRejectedValue(error);
      await actions.handleDeleteCard("c1" as any);
      expect(mockSentryCapture).toHaveBeenCalled();
      const callArgs = mockSentryCapture.mock.calls[0];
      expect(callArgs[0]).toBe(error);
      expect(callArgs[1].tags).toEqual({
        source: "convex",
        mutation: "cards:updateCardField",
        operation: "delete",
      });
    });

    test("includes cardId in Sentry extra context", async () => {
      const error = new Error("fail");
      mockUpdateCardField.mockRejectedValue(error);
      await actions.handleDeleteCard("c123" as any);
      const callArgs = mockSentryCapture.mock.calls[0];
      expect(callArgs[1].extra).toEqual({ cardId: "c123" });
    });
  });

  describe("handleRestoreCard", () => {
    test("calls updateCardField with restore field", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      await actions.handleRestoreCard("c1" as any);
      expect(mockUpdateCardField).toHaveBeenCalledWith({
        cardId: "c1",
        field: "restore",
      });
    });

    test("calls onRestoreSuccess callback with message", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      await actions.handleRestoreCard("c1" as any);
      expect(mockOnRestoreSuccess).toHaveBeenCalledWith("Card restored");
    });

    test("does not call onRestoreSuccess on error", async () => {
      const error = new Error("fail");
      mockUpdateCardField.mockRejectedValue(error);
      await actions.handleRestoreCard("c1" as any);
      expect(mockOnRestoreSuccess).not.toHaveBeenCalled();
    });

    test("calls onError callback on error", async () => {
      const error = new Error("fail");
      mockUpdateCardField.mockRejectedValue(error);
      await actions.handleRestoreCard("c1" as any);
      expect(mockOnError).toHaveBeenCalledWith(error, "restore");
    });

    test("captures exception in Sentry on error", async () => {
      const error = new Error("fail");
      mockUpdateCardField.mockRejectedValue(error);
      await actions.handleRestoreCard("c1" as any);
      expect(mockSentryCapture).toHaveBeenCalled();
      const callArgs = mockSentryCapture.mock.calls[0];
      expect(callArgs[1].tags.operation).toBe("restore");
    });
  });

  describe("handleBulkDeleteCards", () => {
    test("returns summary for full success", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      const result = await actions.handleBulkDeleteCards([
        "c1" as any,
        "c2" as any,
      ]);

      expect(result).toEqual({
        requestedCount: 2,
        deletedCount: 2,
        failedIds: [],
      });
      expect(mockOnDeleteSuccess).not.toHaveBeenCalled();
    });

    test("returns summary with failed ids on partial failure", async () => {
      mockUpdateCardField
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("fail c2"))
        .mockRejectedValueOnce(new Error("fail c3"));

      const result = await actions.handleBulkDeleteCards([
        "c1" as any,
        "c2" as any,
        "c3" as any,
      ]);

      expect(result).toEqual({
        requestedCount: 3,
        deletedCount: 1,
        failedIds: ["c2", "c3"],
      });
      expect(mockOnError).not.toHaveBeenCalled();
      expect(mockOnDeleteSuccess).not.toHaveBeenCalled();
    });

    test("returns full failure summary", async () => {
      mockUpdateCardField.mockRejectedValue(new Error("always fail"));

      const result = await actions.handleBulkDeleteCards([
        "c1" as any,
        "c2" as any,
      ]);

      expect(result).toEqual({
        requestedCount: 2,
        deletedCount: 0,
        failedIds: ["c1", "c2"],
      });
    });
  });

  describe("handlePermanentDeleteCard", () => {
    test("calls permanentDeleteCard with id", async () => {
      mockPermanentDeleteCard.mockResolvedValue(undefined);
      await actions.handlePermanentDeleteCard("c1" as any);
      expect(mockPermanentDeleteCard).toHaveBeenCalledWith({ id: "c1" });
    });

    test("calls onPermanentDeleteSuccess callback with message", async () => {
      mockPermanentDeleteCard.mockResolvedValue(undefined);
      await actions.handlePermanentDeleteCard("c1" as any);
      expect(mockOnPermanentDeleteSuccess).toHaveBeenCalledWith(
        "Card permanently deleted"
      );
    });

    test("does not call onPermanentDeleteSuccess on error", async () => {
      const error = new Error("fail");
      mockPermanentDeleteCard.mockRejectedValue(error);
      await actions.handlePermanentDeleteCard("c1" as any);
      expect(mockOnPermanentDeleteSuccess).not.toHaveBeenCalled();
    });

    test("calls onError callback on error", async () => {
      const error = new Error("fail");
      mockPermanentDeleteCard.mockRejectedValue(error);
      await actions.handlePermanentDeleteCard("c1" as any);
      expect(mockOnError).toHaveBeenCalledWith(error, "permanent delete");
    });

    test("captures exception in Sentry on error", async () => {
      const error = new Error("fail");
      mockPermanentDeleteCard.mockRejectedValue(error);
      await actions.handlePermanentDeleteCard("c1" as any);
      expect(mockSentryCapture).toHaveBeenCalled();
      const callArgs = mockSentryCapture.mock.calls[0];
      expect(callArgs[1].tags.mutation).toBe("cards:permanentDeleteCard");
    });
  });

  describe("handleToggleFavorite", () => {
    test("calls updateCardField with isFavorited field", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      await actions.handleToggleFavorite("c1" as any);
      expect(mockUpdateCardField).toHaveBeenCalledWith({
        cardId: "c1",
        field: "isFavorited",
      });
    });

    test("handles error without success callback", async () => {
      const error = new Error("fail");
      mockUpdateCardField.mockRejectedValue(error);
      await actions.handleToggleFavorite("c1" as any);
      expect(mockOnError).toHaveBeenCalledWith(error, "toggle favorite");
    });

    test("captures exception in Sentry on error", async () => {
      const error = new Error("fail");
      mockUpdateCardField.mockRejectedValue(error);
      await actions.handleToggleFavorite("c1" as any);
      expect(mockSentryCapture).toHaveBeenCalled();
      const callArgs = mockSentryCapture.mock.calls[0];
      expect(callArgs[1].tags.operation).toBe("toggleFavorite");
    });
  });

  describe("updateField", () => {
    test("calls updateCardField with content field", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      await actions.updateField("c1" as any, "content", "new content");
      expect(mockUpdateCardField).toHaveBeenCalledWith({
        cardId: "c1",
        field: "content",
        value: "new content",
        tagToRemove: undefined,
      });
    });

    test("calls updateCardField with url field", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      await actions.updateField("c1" as any, "url", "https://example.com");
      expect(mockUpdateCardField).toHaveBeenCalledWith({
        cardId: "c1",
        field: "url",
        value: "https://example.com",
        tagToRemove: undefined,
      });
    });

    test("calls updateCardField with notes field", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      await actions.updateField("c1" as any, "notes", "some notes");
      expect(mockUpdateCardField).toHaveBeenCalledWith({
        cardId: "c1",
        field: "notes",
        value: "some notes",
        tagToRemove: undefined,
      });
    });

    test("calls updateCardField with tags field", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      await actions.updateField("c1" as any, "tags", ["tag1", "tag2"]);
      expect(mockUpdateCardField).toHaveBeenCalledWith({
        cardId: "c1",
        field: "tags",
        value: ["tag1", "tag2"],
        tagToRemove: undefined,
      });
    });

    test("calls updateCardField with aiSummary field", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      await actions.updateField("c1" as any, "aiSummary", "AI summary");
      expect(mockUpdateCardField).toHaveBeenCalledWith({
        cardId: "c1",
        field: "aiSummary",
        value: "AI summary",
        tagToRemove: undefined,
      });
    });

    test("calls updateCardField with removeAiTag field", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      await actions.updateField("c1" as any, "removeAiTag", undefined);
      expect(mockUpdateCardField).toHaveBeenCalledWith({
        cardId: "c1",
        field: "removeAiTag",
        value: undefined,
        tagToRemove: undefined,
      });
    });

    test("passes tagToRemove parameter", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      await actions.updateField("c1" as any, "tags", undefined, "oldTag");
      expect(mockUpdateCardField).toHaveBeenCalledWith({
        cardId: "c1",
        field: "tags",
        value: undefined,
        tagToRemove: "oldTag",
      });
    });

    test("handles error and calls onError", async () => {
      const error = new Error("fail");
      mockUpdateCardField.mockRejectedValue(error);
      await actions.updateField("c1" as any, "notes", "some notes");
      expect(mockOnError).toHaveBeenCalledWith(error, "update notes");
    });

    test("captures exception in Sentry on error", async () => {
      const error = new Error("fail");
      mockUpdateCardField.mockRejectedValue(error);
      await actions.updateField("c1" as any, "content", "test");
      expect(mockSentryCapture).toHaveBeenCalled();
      const callArgs = mockSentryCapture.mock.calls[0];
      expect(callArgs[1].tags.operation).toBe("update_content");
    });

    test("includes field in Sentry extra context", async () => {
      const error = new Error("fail");
      mockUpdateCardField.mockRejectedValue(error);
      await actions.updateField("c1" as any, "url", "test");
      const callArgs = mockSentryCapture.mock.calls[0];
      expect(callArgs[1].extra).toEqual({
        cardId: "c1",
        field: "url",
        value: "test",
      });
    });
  });

  describe("setSentryCaptureFunction", () => {
    test("sets custom sentry capture function", () => {
      const customCapture = mock();
      setSentryCaptureFunction(customCapture);
      const actions = createCardActions(dependencies, config);
      expect(actions).toBeDefined();
    });

    test("uses default sentry capture if not set", async () => {
      const defaultActions = createCardActions(dependencies);
      mockUpdateCardField.mockRejectedValue(new Error("test"));
      await defaultActions.handleDeleteCard("c1" as any);
      // Should not throw
    });
  });

  describe("error handling", () => {
    test("handles multiple operations without interfering", async () => {
      mockUpdateCardField.mockResolvedValue(undefined);
      await actions.handleDeleteCard("c1" as any);
      await actions.handleRestoreCard("c2" as any);
      await actions.handleToggleFavorite("c3" as any);
      expect(mockUpdateCardField).toHaveBeenCalledTimes(3);
    });

    test("preserves error context for each operation", async () => {
      const error1 = new Error("error1");
      const error2 = new Error("error2");
      mockUpdateCardField
        .mockRejectedValueOnce(error1)
        .mockRejectedValueOnce(error2);

      await actions.handleDeleteCard("c1" as any);
      await actions.handleRestoreCard("c2" as any);

      expect(mockOnError).toHaveBeenCalledTimes(2);
      expect(mockOnError).toHaveBeenNthCalledWith(1, error1, "delete");
      expect(mockOnError).toHaveBeenNthCalledWith(2, error2, "restore");
    });
  });
});
