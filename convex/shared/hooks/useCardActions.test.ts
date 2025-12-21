// @ts-nocheck
import { describe, expect, test, mock, beforeEach } from "bun:test";
import { createCardActions, setSentryCaptureFunction } from "./useCardActions";

describe("defaults", () => {
    test("uses default sentry capture without error", async () => {
        const actions = createCardActions({ updateCardField: mock(), permanentDeleteCard: mock() });
        // Trigger error
        const mockUpdate = mock().mockRejectedValue(new Error("fail"));
        const actions2 = createCardActions({ updateCardField: mockUpdate, permanentDeleteCard: mock() });
        await actions2.handleDeleteCard("c1" as any);
        // Should catch and call default captureException
    });
});

describe("createCardActions", () => {
    const mockPermanentDeleteCard = mock();
    const mockUpdateCardField = mock();
    const mockOnDeleteSuccess = mock();
    const mockOnError = mock();
    const mockSentryCapture = mock();

    const dependencies = {
        permanentDeleteCard: mockPermanentDeleteCard,
        updateCardField: mockUpdateCardField,
    };
    const config = {
        onDeleteSuccess: mockOnDeleteSuccess,
        onError: mockOnError,
    };

    beforeEach(() => {
        mockPermanentDeleteCard.mockReset();
        mockUpdateCardField.mockReset();
        mockOnDeleteSuccess.mockReset();
        mockOnError.mockReset();
        mockSentryCapture.mockReset();
        setSentryCaptureFunction(mockSentryCapture);
    });

    const actions = createCardActions(dependencies, config);

    describe("handleDeleteCard", () => {
        test("calls updateCardField with delete", async () => {
            mockUpdateCardField.mockResolvedValue(undefined);
            await actions.handleDeleteCard("c1" as any);
            expect(mockUpdateCardField).toHaveBeenCalledWith({ cardId: "c1", field: "delete" });
            expect(mockOnDeleteSuccess).toHaveBeenCalled();
        });

        test("handles error", async () => {
            const error = new Error("fail");
            mockUpdateCardField.mockRejectedValue(error);
            await actions.handleDeleteCard("c1" as any);
            expect(mockOnError).toHaveBeenCalledWith(error, "delete");
            expect(mockSentryCapture).toHaveBeenCalled();
        });
    });

    describe("handleRestoreCard", () => {
        test("calls updateCardField with restore", async () => {
            mockUpdateCardField.mockResolvedValue(undefined);
            await actions.handleRestoreCard("c1" as any);
            expect(mockUpdateCardField).toHaveBeenCalledWith({ cardId: "c1", field: "restore" });
        });

        test("handles error", async () => {
            const error = new Error("fail");
            mockUpdateCardField.mockRejectedValue(error);
            await actions.handleRestoreCard("c1" as any);
            expect(mockOnError).toHaveBeenCalledWith(error, "restore");
        });
    });

    describe("handlePermanentDeleteCard", () => {
        test("calls permanentDeleteCard", async () => {
            mockPermanentDeleteCard.mockResolvedValue(undefined);
            await actions.handlePermanentDeleteCard("c1" as any);
            expect(mockPermanentDeleteCard).toHaveBeenCalledWith({ id: "c1" });
        });

        test("handles error", async () => {
            const error = new Error("fail");
            mockPermanentDeleteCard.mockRejectedValue(error);
            await actions.handlePermanentDeleteCard("c1" as any);
            expect(mockOnError).toHaveBeenCalledWith(error, "permanent delete");
        });
    });

    describe("handleToggleFavorite", () => {
        test("calls updateCardField with isFavorited", async () => {
            mockUpdateCardField.mockResolvedValue(undefined);
            await actions.handleToggleFavorite("c1" as any);
            expect(mockUpdateCardField).toHaveBeenCalledWith({ cardId: "c1", field: "isFavorited" });
        });

        test("handles error", async () => {
            const error = new Error("fail");
            mockUpdateCardField.mockRejectedValue(error);
            await actions.handleToggleFavorite("c1" as any);
            expect(mockOnError).toHaveBeenCalledWith(error, "toggle favorite");
        });
    });

    describe("updateField", () => {
        test("calls updateCardField", async () => {
            mockUpdateCardField.mockResolvedValue(undefined);
            await actions.updateField("c1" as any, "notes", "some notes");
            expect(mockUpdateCardField).toHaveBeenCalledWith({ cardId: "c1", field: "notes", value: "some notes", tagToRemove: undefined });
        });

        test("handles error", async () => {
            const error = new Error("fail");
            mockUpdateCardField.mockRejectedValue(error);
            await actions.updateField("c1" as any, "notes", "some notes");
            expect(mockOnError).toHaveBeenCalledWith(error, "update notes");
        });
    });
});
