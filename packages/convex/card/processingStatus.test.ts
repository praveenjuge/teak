import { describe, expect, it } from "bun:test";
import {
  buildInitialProcessingStatus,
  type ProcessingStatus,
  shouldRunCategorizeStage,
  shouldRunRenderablesStage,
  stageCompleted,
  stageFailed,
  stageInProgress,
  stagePending,
  withStageStatus,
} from "./processingStatus";

describe("stageCompleted", () => {
  it("should create a completed stage status", () => {
    const now = Date.now();
    const result = stageCompleted(now);

    expect(result).toEqual({
      status: "completed",
      completedAt: now,
      confidence: 1,
    });
  });

  it("should use custom confidence value", () => {
    const now = Date.now();
    const result = stageCompleted(now, 0.8);

    expect(result.confidence).toBe(0.8);
  });

  it("should default confidence to 1 when not provided", () => {
    const now = Date.now();
    const result = stageCompleted(now);

    expect(result.confidence).toBe(1);
  });
});

describe("stagePending", () => {
  it("should create a pending stage status", () => {
    const result = stagePending();

    expect(result).toEqual({
      status: "pending",
    });
  });

  it("should not have any additional properties", () => {
    const result = stagePending();

    expect(result.startedAt).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
    expect(result.confidence).toBeUndefined();
    expect(result.error).toBeUndefined();
  });
});

describe("stageInProgress", () => {
  it("should create an in_progress stage status", () => {
    const now = Date.now();
    const result = stageInProgress(now);

    expect(result).toEqual({
      status: "in_progress",
      startedAt: now,
    });
  });

  it("should preserve startedAt from previous status", () => {
    const earlier = Date.now() - 10_000;
    const later = Date.now();
    const previous = stageInProgress(earlier);

    const result = stageInProgress(later, previous);

    expect(result.startedAt).toBe(earlier);
    expect(result.status).toBe("in_progress");
  });

  it("should preserve confidence from previous status", () => {
    const now = Date.now();
    const previous = {
      status: "in_progress" as const,
      startedAt: now,
      confidence: 0.5,
    };

    const result = stageInProgress(now, previous);

    expect(result.confidence).toBe(0.5);
  });

  it("should use current time when no previous status provided", () => {
    const now = Date.now();
    const result = stageInProgress(now);

    expect(result.startedAt).toBe(now);
  });
});

describe("stageFailed", () => {
  it("should create a failed stage status", () => {
    const now = Date.now();
    const error = "Something went wrong";
    const result = stageFailed(now, error);

    expect(result).toEqual({
      status: "failed",
      startedAt: now,
      completedAt: now,
      error,
    });
  });

  it("should preserve startedAt from previous status", () => {
    const earlier = Date.now() - 10_000;
    const later = Date.now();
    const previous = stageInProgress(earlier);

    const result = stageFailed(later, "error", previous);

    expect(result.startedAt).toBe(earlier);
    expect(result.completedAt).toBe(later);
  });

  it("should preserve confidence from previous status", () => {
    const now = Date.now();
    const previous = {
      status: "in_progress" as const,
      startedAt: now,
      confidence: 0.7,
    };

    const result = stageFailed(now, "error", previous);

    expect(result.confidence).toBe(0.7);
  });
});

describe("withStageStatus", () => {
  it("should add stage status to empty object", () => {
    const status = stageCompleted(Date.now());
    const result = withStageStatus(undefined, "classify", status);

    expect(result).toEqual({ classify: status });
  });

  it("should add stage status to existing object", () => {
    const existing: ProcessingStatus = {
      classify: stageCompleted(Date.now()),
    };
    const newStatus = stagePending();
    const result = withStageStatus(existing, "categorize", newStatus);

    expect(result.classify).toEqual(existing.classify);
    expect(result.categorize).toEqual(newStatus);
  });

  it("should overwrite existing stage status", () => {
    const existing: ProcessingStatus = {
      classify: stagePending(),
    };
    const newStatus = stageCompleted(Date.now());
    const result = withStageStatus(existing, "classify", newStatus);

    expect(result.classify).toEqual(newStatus);
  });

  it("should preserve other stage statuses", () => {
    const existing: ProcessingStatus = {
      classify: stageCompleted(Date.now()),
      categorize: stagePending(),
    };
    const newStatus = stageInProgress(Date.now());
    const result = withStageStatus(existing, "metadata", newStatus);

    expect(result.classify).toEqual(existing.classify);
    expect(result.categorize).toEqual(existing.categorize);
    expect(result.metadata).toEqual(newStatus);
  });
});

describe("shouldRunRenderablesStage", () => {
  it("should return true for image type", () => {
    expect(shouldRunRenderablesStage("image")).toBe(true);
  });

  it("should return true for video type", () => {
    expect(shouldRunRenderablesStage("video")).toBe(true);
  });

  it("should return true for document type", () => {
    expect(shouldRunRenderablesStage("document")).toBe(true);
  });

  it("should return false for text type", () => {
    expect(shouldRunRenderablesStage("text")).toBe(false);
  });

  it("should return false for link type", () => {
    expect(shouldRunRenderablesStage("link")).toBe(false);
  });

  it("should return false for audio type", () => {
    expect(shouldRunRenderablesStage("audio")).toBe(false);
  });

  it("should return false for palette type", () => {
    expect(shouldRunRenderablesStage("palette")).toBe(false);
  });

  it("should return false for quote type", () => {
    expect(shouldRunRenderablesStage("quote")).toBe(false);
  });
});

describe("shouldRunCategorizeStage", () => {
  it("should return true for link type", () => {
    expect(shouldRunCategorizeStage("link")).toBe(true);
  });

  it("should return false for text type", () => {
    expect(shouldRunCategorizeStage("text")).toBe(false);
  });

  it("should return false for image type", () => {
    expect(shouldRunCategorizeStage("image")).toBe(false);
  });

  it("should return false for video type", () => {
    expect(shouldRunCategorizeStage("video")).toBe(false);
  });

  it("should return false for audio type", () => {
    expect(shouldRunCategorizeStage("audio")).toBe(false);
  });

  it("should return false for document type", () => {
    expect(shouldRunCategorizeStage("document")).toBe(false);
  });

  it("should return false for palette type", () => {
    expect(shouldRunCategorizeStage("palette")).toBe(false);
  });

  it("should return false for quote type", () => {
    expect(shouldRunCategorizeStage("quote")).toBe(false);
  });
});

describe("buildInitialProcessingStatus", () => {
  const now = Date.now();

  it("should build initial status for link card type", () => {
    const result = buildInitialProcessingStatus({ now, cardType: "link" });

    expect(result.categorize?.status).toBe("pending");
    expect(result.metadata?.status).toBe("pending");
    expect(result.renderables?.status).toBe("completed");
  });

  it("should build initial status for image card type", () => {
    const result = buildInitialProcessingStatus({ now, cardType: "image" });

    expect(result.categorize?.status).toBe("completed");
    expect(result.metadata?.status).toBe("pending");
    expect(result.renderables?.status).toBe("pending");
  });

  it("should build initial status for video card type", () => {
    const result = buildInitialProcessingStatus({ now, cardType: "video" });

    expect(result.categorize?.status).toBe("completed");
    expect(result.metadata?.status).toBe("pending");
    expect(result.renderables?.status).toBe("pending");
  });

  it("should build initial status for document card type", () => {
    const result = buildInitialProcessingStatus({ now, cardType: "document" });

    expect(result.categorize?.status).toBe("completed");
    expect(result.metadata?.status).toBe("pending");
    expect(result.renderables?.status).toBe("pending");
  });

  it("should build initial status for text card type", () => {
    const result = buildInitialProcessingStatus({ now, cardType: "text" });

    expect(result.categorize?.status).toBe("completed");
    expect(result.metadata?.status).toBe("pending");
    expect(result.renderables?.status).toBe("completed");
  });

  it("should include classification status when provided", () => {
    const classificationStatus = stageCompleted(now, 0.9);
    const result = buildInitialProcessingStatus({
      now,
      cardType: "link",
      classificationStatus,
    });

    expect(result.classify).toEqual(classificationStatus);
  });

  it("should not include classification status when not provided", () => {
    const result = buildInitialProcessingStatus({ now, cardType: "link" });

    expect(result.classify).toBeUndefined();
  });

  it("should set metadata to completed when metadataStageNeeded is false", () => {
    const result = buildInitialProcessingStatus({
      now,
      cardType: "link",
      metadataStageNeeded: false,
    });

    expect(result.metadata?.status).toBe("completed");
  });

  it("should override categorize stage when categorizeStageOverride is true", () => {
    const result = buildInitialProcessingStatus({
      now,
      cardType: "text",
      categorizeStageOverride: true,
    });

    expect(result.categorize?.status).toBe("pending");
  });

  it("should override categorize stage when categorizeStageOverride is false", () => {
    const result = buildInitialProcessingStatus({
      now,
      cardType: "link",
      categorizeStageOverride: false,
    });

    expect(result.categorize?.status).toBe("completed");
  });

  it("should override renderables stage when renderablesStageOverride is true", () => {
    const result = buildInitialProcessingStatus({
      now,
      cardType: "text",
      renderablesStageOverride: true,
    });

    expect(result.renderables?.status).toBe("pending");
  });

  it("should override renderables stage when renderablesStageOverride is false", () => {
    const result = buildInitialProcessingStatus({
      now,
      cardType: "image",
      renderablesStageOverride: false,
    });

    expect(result.renderables?.status).toBe("completed");
  });

  it("should set confidence to 1 for completed stages", () => {
    const result = buildInitialProcessingStatus({ now, cardType: "text" });

    expect(result.categorize?.confidence).toBe(1);
    expect(result.renderables?.confidence).toBe(1);
    // metadata is pending by default (metadataStageNeeded = true)
    expect(result.metadata?.confidence).toBeUndefined();
  });

  it("should set completedAt timestamp for completed stages", () => {
    const result = buildInitialProcessingStatus({ now, cardType: "text" });

    expect(result.categorize?.completedAt).toBe(now);
    expect(result.renderables?.completedAt).toBe(now);
    // metadata is pending by default (metadataStageNeeded = true)
    expect(result.metadata?.completedAt).toBeUndefined();
  });
});
