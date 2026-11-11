import { describe, expect, it } from "bun:test";
import {
  buildInitialProcessingStatus,
  type ProcessingStatus,
  stageCompleted,
  stageFailed,
  stageInProgress,
  stagePending,
  withStageStatus,
} from "../../shared/processingStatus";

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

describe("buildInitialProcessingStatus", () => {
  const now = Date.now();
  const statuses = (status: ProcessingStatus) =>
    Object.fromEntries(
      Object.entries(status).map(([stage, value]) => [stage, value?.status])
    );

  it.each([
    [
      "link",
      {
        archive: "pending",
        article: "pending",
        categorize: "pending",
        metadata: "pending",
        renderables: "completed",
      },
    ],
    [
      "image",
      { categorize: "completed", metadata: "pending", renderables: "pending" },
    ],
    [
      "video",
      { categorize: "completed", metadata: "pending", renderables: "pending" },
    ],
    [
      "document",
      { categorize: "completed", metadata: "pending", renderables: "pending" },
    ],
    [
      "text",
      {
        categorize: "completed",
        metadata: "pending",
        renderables: "completed",
      },
    ],
    [
      "palette",
      {
        categorize: "completed",
        metadata: "pending",
        renderables: "completed",
      },
    ],
  ] as const)(
    "a new %s card starts with the stages it runs",
    (cardType, expected) => {
      expect(statuses(buildInitialProcessingStatus({ now, cardType }))).toEqual(
        expected
      );
    }
  );

  it("keeps a link's archive and article as the caller says, for a reset", () => {
    const archived = stageCompleted(now);
    const result = buildInitialProcessingStatus({
      archive: { archive: archived },
      cardType: "link",
      now,
    });
    expect(result.archive).toEqual(archived);
    expect(result.article).toBeUndefined();
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

  it("should set confidence to 1 for completed stages", () => {
    const result = buildInitialProcessingStatus({ now, cardType: "text" });

    expect(result.categorize?.confidence).toBe(1);
    expect(result.renderables?.confidence).toBe(1);
    expect(result.metadata?.confidence).toBeUndefined();
  });

  it("should set completedAt timestamp for completed stages", () => {
    const result = buildInitialProcessingStatus({ now, cardType: "text" });

    expect(result.categorize?.completedAt).toBe(now);
    expect(result.renderables?.completedAt).toBe(now);
    expect(result.metadata?.completedAt).toBeUndefined();
  });
});
