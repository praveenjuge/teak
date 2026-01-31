// @ts-nocheck
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  initializeCardProcessingStateHandler,
  startCardProcessingWorkflowHandler,
  workflow,
} from "../../../convex/workflows/manager";

describe("workflow manager", () => {
  describe("initializeCardProcessingState", () => {
    const mockDbGet = mock();
    const mockDbPatch = mock();
    const ctx = {
      db: { get: mockDbGet, patch: mockDbPatch },
    } as any;

    beforeEach(() => {
      mockDbGet.mockReset();
      mockDbPatch.mockReset();
    });

    test("throws if card not found", async () => {
      mockDbGet.mockResolvedValue(null);
      expect(
        initializeCardProcessingStateHandler(ctx, { cardId: "c1" })
      ).rejects.toThrow("Card c1 not found");
    });

    test("initializes processing state for text card", async () => {
      mockDbGet.mockResolvedValue({ _id: "c1", type: "text" });
      await initializeCardProcessingStateHandler(ctx, { cardId: "c1" });

      expect(mockDbPatch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          aiTags: undefined,
          processingStatus: expect.objectContaining({
            metadata: expect.objectContaining({ status: "pending" }),
          }),
        })
      );
    });

    test("handles link card waiting for preview", async () => {
      mockDbGet.mockResolvedValue({
        _id: "c1",
        type: "link",
        metadata: { linkPreview: { status: "pending" } },
      });
      await initializeCardProcessingStateHandler(ctx, { cardId: "c1" });

      expect(mockDbPatch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadataStatus: "pending",
        })
      );
    });

    test("handles link card with success preview", async () => {
      mockDbGet.mockResolvedValue({
        _id: "c1",
        type: "link",
        metadata: { linkPreview: { status: "success" } },
      });
      await initializeCardProcessingStateHandler(ctx, { cardId: "c1" });

      expect(mockDbPatch).toHaveBeenCalledWith(
        "cards",
        "c1",
        expect.objectContaining({
          metadataStatus: "completed",
        })
      );
    });
  });

  describe("startCardProcessingWorkflow", () => {
    const mockWorkflowStart = mock();
    const mockRunMutation = mock();
    const ctx = { runMutation: mockRunMutation } as any;

    // Mock workflow instance method
    workflow.start = mockWorkflowStart;

    beforeEach(() => {
      mockWorkflowStart.mockReset();
      mockRunMutation.mockReset();
    });

    test("starts workflow and initializes state", async () => {
      mockWorkflowStart.mockResolvedValue("wf_123");
      const result = await startCardProcessingWorkflowHandler(ctx, {
        cardId: "c1",
      });

      expect(mockWorkflowStart).toHaveBeenCalledWith(
        ctx,
        expect.anything(),
        { cardId: "c1" },
        { startAsync: true }
      );
      expect(mockRunMutation).toHaveBeenCalled();
      expect(result).toEqual({ workflowId: "wf_123" });
    });
  });
});
