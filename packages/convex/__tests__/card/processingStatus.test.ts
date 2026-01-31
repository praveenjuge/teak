// @ts-nocheck
import { describe, expect, test } from "bun:test";
import {
  buildInitialProcessingStatus,
  type ProcessingStageStatus,
  shouldRunCategorizeStage,
  shouldRunRenderablesStage,
  stageCompleted,
  stageFailed,
  stageInProgress,
  stagePending,
  withStageStatus,
} from "../../../convex/card/processingStatus";

describe("processingStatus", () => {
  const now = 1000;

  describe("stage factories", () => {
    test("stageCompleted returns completed status", () => {
      expect(stageCompleted(now)).toEqual({
        status: "completed",
        completedAt: now,
        confidence: 1,
      });
    });

    test("stageCompleted accepts confidence", () => {
      expect(stageCompleted(now, 0.5)).toEqual({
        status: "completed",
        completedAt: now,
        confidence: 0.5,
      });
    });

    test("stagePending returns pending status", () => {
      expect(stagePending()).toEqual({ status: "pending" });
    });

    test("stageInProgress initializes new stage", () => {
      expect(stageInProgress(now)).toEqual({
        status: "in_progress",
        startedAt: now,
        confidence: undefined,
      });
    });

    test("stageInProgress preserves previous start time and confidence", () => {
      const prev: ProcessingStageStatus = {
        status: "pending",
        startedAt: 500,
        confidence: 0.8,
      };
      expect(stageInProgress(now, prev)).toEqual({
        status: "in_progress",
        startedAt: 500,
        confidence: 0.8,
      });
    });

    test("stageFailed initializes new failed stage", () => {
      expect(stageFailed(now, "error")).toEqual({
        status: "failed",
        startedAt: now,
        completedAt: now,
        confidence: undefined,
        error: "error",
      });
    });

    test("stageFailed preserves previous info", () => {
      const prev: ProcessingStageStatus = {
        status: "in_progress",
        startedAt: 500,
        confidence: 0.8,
      };
      expect(stageFailed(now, "error", prev)).toEqual({
        status: "failed",
        startedAt: 500,
        completedAt: now,
        confidence: 0.8,
        error: "error",
      });
    });
  });

  describe("withStageStatus", () => {
    test("creates new status object if current is undefined", () => {
      const status = stagePending();
      expect(withStageStatus(undefined, "classify", status)).toEqual({
        classify: status,
      });
    });

    test("updates existing status", () => {
      const current = { classify: stageCompleted(now) };
      const status = stagePending();
      expect(withStageStatus(current, "metadata", status)).toEqual({
        classify: current.classify,
        metadata: status,
      });
    });
  });

  describe("shouldRunRenderablesStage", () => {
    test("returns true for image, video, document", () => {
      expect(shouldRunRenderablesStage("image")).toBe(true);
      expect(shouldRunRenderablesStage("video")).toBe(true);
      expect(shouldRunRenderablesStage("document")).toBe(true);
    });

    test("returns false for link, note, text", () => {
      expect(shouldRunRenderablesStage("link")).toBe(false);
      expect(shouldRunRenderablesStage("text")).toBe(false);
      expect(shouldRunRenderablesStage("text" as any)).toBe(false);
    });
  });

  describe("shouldRunCategorizeStage", () => {
    test("returns true for link", () => {
      expect(shouldRunCategorizeStage("link")).toBe(true);
    });

    test("returns false for others", () => {
      expect(shouldRunCategorizeStage("image")).toBe(false);
      expect(shouldRunCategorizeStage("text")).toBe(false);
    });
  });

  describe("buildInitialProcessingStatus", () => {
    test("handles classification status", () => {
      const classifyStatus = stageCompleted(now);
      const result = buildInitialProcessingStatus({
        now,
        cardType: "link",
        classificationStatus: classifyStatus,
      });
      expect(result.classify).toBe(classifyStatus);
    });

    test("sets metadata stage based on flag", () => {
      const res1 = buildInitialProcessingStatus({ now, cardType: "text" });
      expect(res1.metadata?.status).toBe("pending");

      const res2 = buildInitialProcessingStatus({
        now,
        cardType: "text",
        metadataStageNeeded: false,
      });
      expect(res2.metadata?.status).toBe("completed");
    });

    test("sets categorize stage for links", () => {
      const res = buildInitialProcessingStatus({ now, cardType: "link" });
      expect(res.categorize?.status).toBe("pending");
    });

    test("skips categorize stage for non-links", () => {
      const res = buildInitialProcessingStatus({ now, cardType: "text" });
      expect(res.categorize?.status).toBe("completed");
    });

    test("respects categorize stage override", () => {
      const res = buildInitialProcessingStatus({
        now,
        cardType: "text",
        categorizeStageOverride: true,
      });
      expect(res.categorize?.status).toBe("pending");
    });

    test("sets renderables stage for renderable types", () => {
      const res = buildInitialProcessingStatus({ now, cardType: "image" });
      expect(res.renderables?.status).toBe("pending");
    });

    test("skips renderables stage for non-renderable types", () => {
      const res = buildInitialProcessingStatus({ now, cardType: "link" });
      expect(res.renderables?.status).toBe("completed");
    });

    test("respects renderables stage override", () => {
      const res = buildInitialProcessingStatus({
        now,
        cardType: "link",
        renderablesStageOverride: true,
      });
      expect(res.renderables?.status).toBe("pending");
    });
  });
});
