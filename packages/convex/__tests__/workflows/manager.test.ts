// @ts-nocheck
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  cleanupCompletedWorkflowHandler,
  cleanupWorkflowHistoryBatchHandler,
  initializeCardProcessingStateHandler,
  MAX_WORKFLOW_CLEANUP_BATCH_SIZE,
  scheduleCompletedWorkflowCleanupHandler,
  scheduleWorkflowHistoryCleanupBatchHandler,
  startCardProcessingWorkflowHandler,
  WORKFLOW_CLEANUP_RETRY_MS,
  WORKFLOW_MAX_PARALLELISM,
  WORKFLOW_RETENTION_MS,
  workflow,
} from "../../../convex/workflows/manager";

describe("workflow manager", () => {
  test("limits workflow step parallelism to ten", () => {
    expect(WORKFLOW_MAX_PARALLELISM).toBe(10);
    expect(workflow.options?.workpoolOptions.maxParallelism).toBe(10);
  });
  describe("initializeCardProcessingState", () => {
    const mockDbGet = mock();
    const mockDbPatch = mock();
    const ctx = {
      db: { get: mockDbGet, patch: mockDbPatch },
      scheduler: { runAfter: mock().mockResolvedValue(null) },
    } as any;

    beforeEach(() => {
      mockDbGet.mockReset();
      mockDbPatch.mockReset();
    });

    test("throws if card not found", () => {
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
        {
          context: null,
          onComplete: expect.anything(),
          startAsync: true,
        }
      );
      expect(mockRunMutation).toHaveBeenCalled();
      expect(result).toEqual({ workflowId: "wf_123" });
    });
  });

  describe("workflow retention", () => {
    const originalCleanup = workflow.cleanup;

    afterEach(() => {
      workflow.cleanup = originalCleanup;
    });

    test("schedules cleanup seven days after completion", async () => {
      const runAfter = mock().mockResolvedValue("scheduled_123");
      const runQuery = mock().mockResolvedValue({
        workflow: { generationNumber: 3 },
      });

      await scheduleCompletedWorkflowCleanupHandler(
        { runQuery, scheduler: { runAfter } } as any,
        "wf_123" as any
      );

      expect(runAfter).toHaveBeenCalledWith(
        WORKFLOW_RETENTION_MS,
        expect.anything(),
        { generationNumber: 3, workflowId: "wf_123" }
      );
    });

    test("retries cleanup when a retained workflow is active again", async () => {
      const runQuery = mock().mockResolvedValue({
        workflow: { generationNumber: 3 },
      });
      const cleanup = mock().mockResolvedValue(true);
      workflow.cleanup = cleanup;
      const runAfter = mock().mockResolvedValue("scheduled_retry");
      const ctx = { runQuery, scheduler: { runAfter } } as any;

      const cleaned = await cleanupCompletedWorkflowHandler(
        ctx,
        "wf_123" as any,
        3
      );

      expect(cleaned).toBe(false);
      expect(cleanup).not.toHaveBeenCalled();
      expect(runAfter).toHaveBeenCalledWith(
        WORKFLOW_CLEANUP_RETRY_MS,
        expect.anything(),
        { generationNumber: 3, workflowId: "wf_123" }
      );
    });

    test("ignores a stale cleanup timer after workflow restart", async () => {
      const runQuery = mock().mockResolvedValue({
        workflow: {
          generationNumber: 4,
          runResult: { kind: "success", returnValue: null },
        },
      });
      const cleanup = mock().mockResolvedValue(true);
      workflow.cleanup = cleanup;
      const runAfter = mock().mockResolvedValue("scheduled_retry");
      const ctx = { runQuery, scheduler: { runAfter } } as any;

      const cleaned = await cleanupCompletedWorkflowHandler(
        ctx,
        "wf_123" as any,
        3
      );

      expect(cleaned).toBe(false);
      expect(cleanup).not.toHaveBeenCalled();
      expect(runAfter).not.toHaveBeenCalled();
    });

    test("dry-runs and cleans only completed workflow IDs", async () => {
      const cutoffMs = Date.now() - WORKFLOW_RETENTION_MS;
      const runQuery = mock((_reference: any, { workflowId }: any) => {
        if (workflowId === "wf_running") {
          return {
            journalEntries: [],
            ok: true,
            workflow: { _creationTime: cutoffMs - 1 },
          };
        }
        if (workflowId === "wf_missing") {
          throw new Error("Workflow not found: wf_missing");
        }
        return {
          journalEntries: [
            {
              step: {
                completedAt:
                  workflowId === "wf_recent" ? cutoffMs + 1 : cutoffMs - 1,
              },
            },
          ],
          ok: true,
          workflow: {
            _creationTime: cutoffMs - 1,
            runResult: { kind: "success", returnValue: null },
          },
        };
      });
      const cleanup = mock().mockResolvedValue(true);
      workflow.cleanup = cleanup;
      const ctx = { runQuery } as any;
      const workflowIds = [
        "wf_completed",
        "wf_running",
        "wf_missing",
        "wf_recent",
        "wf_completed",
      ] as any;

      const preview = await cleanupWorkflowHistoryBatchHandler(ctx, {
        cutoffMs,
        dryRun: true,
        workflowIds,
      });

      expect(preview).toEqual({
        cleanedCount: 0,
        eligibleCount: 1,
        inProgressCount: 1,
        missingCount: 1,
        noTimestampCount: 0,
        oversizedCount: 0,
        recentCount: 1,
        uniqueCount: 4,
      });
      expect(cleanup).not.toHaveBeenCalled();

      const applied = await cleanupWorkflowHistoryBatchHandler(ctx, {
        cutoffMs,
        dryRun: false,
        workflowIds,
      });

      expect(applied).toEqual({
        cleanedCount: 1,
        eligibleCount: 0,
        inProgressCount: 1,
        missingCount: 1,
        noTimestampCount: 0,
        oversizedCount: 0,
        recentCount: 1,
        uniqueCount: 4,
      });
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledWith(ctx, "wf_completed");
    });

    test("uses terminal step completion time instead of workflow creation time", async () => {
      const cutoffMs = Date.now() - WORKFLOW_RETENTION_MS;
      const runQuery = mock().mockResolvedValue({
        journalEntries: [{ step: { completedAt: cutoffMs + 1 } }],
        ok: true,
        workflow: {
          _creationTime: cutoffMs - WORKFLOW_RETENTION_MS,
          runResult: { kind: "success", returnValue: null },
        },
      });
      const cleanup = mock().mockResolvedValue(true);
      workflow.cleanup = cleanup;

      const result = await cleanupWorkflowHistoryBatchHandler(
        { runQuery } as any,
        {
          cutoffMs,
          dryRun: false,
          workflowIds: ["wf_recent_completion"] as any,
        }
      );

      expect(result.recentCount).toBe(1);
      expect(result.cleanedCount).toBe(0);
      expect(cleanup).not.toHaveBeenCalled();
    });

    test("preserves workflows whose complete journal cannot be inspected", async () => {
      const cutoffMs = Date.now() - WORKFLOW_RETENTION_MS;
      const runQuery = mock().mockResolvedValue({
        journalEntries: [],
        ok: false,
        workflow: {
          _creationTime: cutoffMs - 1,
          runResult: { kind: "success", returnValue: null },
        },
      });
      const cleanup = mock().mockResolvedValue(true);
      workflow.cleanup = cleanup;

      const result = await cleanupWorkflowHistoryBatchHandler(
        { runQuery } as any,
        {
          cutoffMs,
          dryRun: false,
          workflowIds: ["wf_oversized"] as any,
        }
      );

      expect(result.oversizedCount).toBe(1);
      expect(result.cleanedCount).toBe(0);
      expect(cleanup).not.toHaveBeenCalled();
    });

    test("schedules historical cleanup from the original completion time", async () => {
      const now = Date.now();
      const completedAt = now - WORKFLOW_RETENTION_MS + 60_000;
      const runQuery = mock().mockResolvedValue({
        journalEntries: [{ step: { completedAt } }],
        ok: true,
        workflow: {
          _creationTime: completedAt - 1000,
          generationNumber: 3,
          runResult: { kind: "success", returnValue: null },
        },
      });
      const runAfter = mock().mockResolvedValue("scheduled_transition");

      const result = await scheduleWorkflowHistoryCleanupBatchHandler(
        { runQuery, scheduler: { runAfter } } as any,
        { dryRun: false, workflowIds: ["wf_123"] as any }
      );

      expect(result).toEqual({
        eligibleCount: 0,
        failedCount: 0,
        inProgressCount: 0,
        missingCount: 0,
        noTimestampCount: 0,
        oversizedCount: 0,
        scheduledCount: 1,
        uniqueCount: 1,
      });
      const [delay, , args] = runAfter.mock.calls[0];
      expect(delay).toBeGreaterThanOrEqual(59_000);
      expect(delay).toBeLessThanOrEqual(60_000);
      expect(args).toEqual({ generationNumber: 3, workflowId: "wf_123" });
    });

    test("fails closed when historical workflow journals are incomplete", async () => {
      const runQuery = mock().mockResolvedValue({
        journalEntries: [],
        ok: false,
        workflow: {
          _creationTime: Date.now(),
          generationNumber: 3,
          runResult: { kind: "success", returnValue: null },
        },
      });
      const runAfter = mock().mockResolvedValue("scheduled_transition");

      const result = await scheduleWorkflowHistoryCleanupBatchHandler(
        { runQuery, scheduler: { runAfter } } as any,
        { dryRun: false, workflowIds: ["wf_oversized"] as any }
      );

      expect(result.oversizedCount).toBe(1);
      expect(result.scheduledCount).toBe(0);
      expect(runAfter).not.toHaveBeenCalled();
    });

    test("fails closed when historical completion timestamps are missing", async () => {
      const runQuery = mock().mockResolvedValue({
        journalEntries: [{ step: {} }],
        ok: true,
        workflow: {
          _creationTime: Date.now() - WORKFLOW_RETENTION_MS,
          generationNumber: 3,
          runResult: { kind: "success", returnValue: null },
        },
      });
      const runAfter = mock().mockResolvedValue("scheduled_transition");

      const result = await scheduleWorkflowHistoryCleanupBatchHandler(
        { runQuery, scheduler: { runAfter } } as any,
        { dryRun: false, workflowIds: ["wf_no_timestamp"] as any }
      );

      expect(result.noTimestampCount).toBe(1);
      expect(result.scheduledCount).toBe(0);
      expect(runAfter).not.toHaveBeenCalled();
    });

    test("reports partial scheduling failures without losing successful counts", async () => {
      const runQuery = mock().mockResolvedValue({
        journalEntries: [{ step: { completedAt: Date.now() } }],
        ok: true,
        workflow: {
          _creationTime: Date.now(),
          generationNumber: 3,
          runResult: { kind: "success", returnValue: null },
        },
      });
      const runAfter = mock((_delay: number, _reference: any, args: any) => {
        if (args.workflowId === "wf_failed") {
          throw new Error("scheduler unavailable");
        }
        return "scheduled_transition";
      });

      const result = await scheduleWorkflowHistoryCleanupBatchHandler(
        { runQuery, scheduler: { runAfter } } as any,
        {
          dryRun: false,
          workflowIds: ["wf_scheduled", "wf_failed"] as any,
        }
      );

      expect(result.failedCount).toBe(1);
      expect(result.scheduledCount).toBe(1);
    });

    test("dry-runs historical cleanup scheduling without creating timers", async () => {
      const runQuery = mock().mockResolvedValue({
        journalEntries: [{ step: { completedAt: Date.now() } }],
        ok: true,
        workflow: {
          _creationTime: Date.now(),
          generationNumber: 3,
          runResult: { kind: "success", returnValue: null },
        },
      });
      const runAfter = mock().mockResolvedValue("scheduled_transition");

      const result = await scheduleWorkflowHistoryCleanupBatchHandler(
        { runQuery, scheduler: { runAfter } } as any,
        { dryRun: true, workflowIds: ["wf_123"] as any }
      );

      expect(result.eligibleCount).toBe(1);
      expect(result.scheduledCount).toBe(0);
      expect(runAfter).not.toHaveBeenCalled();
    });

    test("rejects oversized maintenance batches", () => {
      expect(
        cleanupWorkflowHistoryBatchHandler({} as any, {
          cutoffMs: Date.now() - WORKFLOW_RETENTION_MS,
          dryRun: true,
          workflowIds: Array.from(
            { length: MAX_WORKFLOW_CLEANUP_BATCH_SIZE + 1 },
            (_, index) => `wf_${index}`
          ) as any,
        })
      ).rejects.toThrow("workflowIds must contain 1-100 unique IDs");
    });

    test("rejects a cutoff that would delete recent history", () => {
      expect(
        cleanupWorkflowHistoryBatchHandler({} as any, {
          cutoffMs: Date.now() - WORKFLOW_RETENTION_MS + 60_000,
          dryRun: true,
          workflowIds: ["wf_completed"] as any,
        })
      ).rejects.toThrow(
        "cutoffMs must preserve at least seven days of history"
      );
    });

    test("rejects non-finite retention cutoffs", () => {
      expect(
        cleanupWorkflowHistoryBatchHandler({} as any, {
          cutoffMs: Number.NaN,
          dryRun: true,
          workflowIds: ["wf_completed"] as any,
        })
      ).rejects.toThrow(
        "cutoffMs must preserve at least seven days of history"
      );
    });
  });
});
