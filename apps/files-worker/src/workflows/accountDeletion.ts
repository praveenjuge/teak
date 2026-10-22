import { internal } from "@teak/convex/_generated/api";
import type { Id } from "@teak/convex/_generated/dataModel";
import type { DeletionBatchKind } from "@teak/convex/accountDeletion/batch";
import {
  ACCOUNT_DELETION_STAGES,
  ACCOUNT_DELETION_STAGES_DONE,
  accountDeletionStage,
  deletionFailureReason,
} from "@teak/convex/accountDeletion/stages";
import { VECTOR_DELETE_MAX_IDS } from "@teak/files-protocol";
import type { ConvexRpc } from "../convexRpc";
import {
  type FilesOpCaller,
  resolveDeps,
  settleConvexErrors,
  type WorkflowDeps,
  withinBudget,
} from "./deps";
import { isMissingInstance, workflowBinding } from "./dispatch";
import {
  CONVEX_STEP,
  runReported,
  type StepConfig,
  type WorkflowRun,
} from "./runtime";

export interface AccountDeletionParams {
  generation: number;
  stateId: string;
}

const RETRY_CAP_MS = 5 * 60 * 1000;

const STAGE_STEP: StepConfig = {
  retries: {
    delay: ({ ctx }) => Math.min(RETRY_CAP_MS, 10_000 * 2 ** (ctx.attempt - 1)),
    limit: 10,
  },
  timeout: "15 minutes",
};

const ACCOUNT_DATA = accountDeletionStage("accountData");
const ACTIVE_RUN_STATUSES = new Set([
  "paused",
  "queued",
  "running",
  "waiting",
  "waitingForPause",
]);

interface DeletionBinding {
  generation: number;
  stateId: Id<"accountDeletionStates">;
}

export const drainStorageBatch = async (
  { convex, ops }: { convex: ConvexRpc; ops: FilesOpCaller },
  binding: DeletionBinding,
  kind: DeletionBatchKind
): Promise<boolean> => {
  const page = await convex.mutation(
    internal.accountDeletionData.prepareStorageBatch,
    { ...binding, kind }
  );
  if (page.empty) {
    return true;
  }
  for (const abort of page.aborts) {
    const aborted = await ops({ op: "abort-multipart", params: abort });
    if (aborted.kind !== "ok") {
      throw new Error("deletion_upload_abort_failed");
    }
  }
  const keys = [...new Set(page.keys)];
  if (keys.length > 0) {
    for (const key of keys) {
      const frozen = await ops<{ frozen: boolean }>({
        op: "freeze-object",
        params: { key },
      });
      if (frozen.kind !== "ok" || !frozen.data.frozen) {
        throw new Error("deletion_object_write_pending");
      }
    }
    const deleted = await ops({ op: "delete-objects", params: { keys } });
    if (deleted.kind !== "ok") {
      throw new Error("files_worker_delete_objects_unavailable");
    }
  }
  await convex.mutation(internal.accountDeletionData.checkpointStorageBatch, {
    ...binding,
    count: page.keys.length,
    fingerprint: page.fingerprint,
    kind,
    offset: page.offset,
  });
  return false;
};

export const runAccountDeletion = (
  run: WorkflowRun<AccountDeletionParams>,
  deps: WorkflowDeps = {}
): Promise<null> => {
  const { convex, ops } = resolveDeps(run, deps);
  const { env, step } = run;
  const binding: DeletionBinding = {
    generation: run.params.generation,
    stateId: run.params.stateId as Id<"accountDeletionStates">,
  };

  const untilDone = async (name: string, page: () => Promise<boolean>) => {
    for (let index = 1; ; index += 1) {
      if (await step.do(`${name} ${index}`, STAGE_STEP, page)) {
        return;
      }
    }
  };

  const isRunning = async (
    table: "exportJobs" | "importJobs",
    instanceId: string
  ): Promise<boolean> => {
    const workflows = workflowBinding(
      env,
      table === "importJobs" ? "import" : "export"
    );
    if (!workflows) {
      return false;
    }
    try {
      const { status } = await (await workflows.get(instanceId)).status();
      return ACTIVE_RUN_STATUSES.has(status);
    } catch (error) {
      if (isMissingInstance(error)) {
        return false;
      }
      throw error;
    }
  };

  const prepareWritersPage = async (): Promise<boolean> => {
    const state = await convex.query(
      internal.accountDeletionJobs.getState,
      binding
    );
    if (state.stage !== ACCOUNT_DATA) {
      throw new Error("stale_deletion_stage");
    }
    if (state.writersPrepared) {
      return true;
    }
    const table = state.writerTable ?? "importJobs";
    const previous = state.writerCursor ?? null;
    const page = await convex.mutation(
      internal.accountDeletionData.cancelJobsPage,
      { ...binding, cursor: previous, table }
    );
    for (const instanceId of page.workflowIds) {
      if (await isRunning(table, instanceId)) {
        throw new Error("deletion_job_still_running");
      }
    }
    await convex.mutation(internal.accountDeletionData.checkpointWriters, {
      ...binding,
      done: page.done,
      next: page.cursor,
      previous,
      table,
    });
    return table === "exportJobs" && page.done;
  };

  const drainStorage = (kinds: DeletionBatchKind[]) => async () => {
    const startedAt = Date.now();
    for (const kind of kinds) {
      while (!(await drainStorageBatch({ convex, ops }, binding, kind))) {
        if (!withinBudget(startedAt)) {
          return false;
        }
      }
    }
    return true;
  };

  const purgeVectors = (userId: string) => async () => {
    const startedAt = Date.now();
    for (;;) {
      const rows: Array<{ cardId: string; rowId: string; shard?: number }> =
        await convex.query(internal.embedding.state.accountEmbeddingsPage, {
          userId,
        });
      if (rows.length === 0) {
        return true;
      }
      const byShard = new Map<number, string[]>();
      for (const row of rows) {
        if (row.shard !== undefined) {
          byShard.set(row.shard, [
            ...(byShard.get(row.shard) ?? []),
            row.cardId,
          ]);
        }
      }
      for (const [shard, ids] of byShard) {
        for (
          let start = 0;
          start < ids.length;
          start += VECTOR_DELETE_MAX_IDS
        ) {
          const outcome = await ops({
            op: "vector-delete",
            params: {
              ids: ids.slice(start, start + VECTOR_DELETE_MAX_IDS),
              shard,
            },
          });
          if (outcome.kind !== "ok") {
            throw new Error(`vector_delete_${outcome.code}`);
          }
        }
      }
      await convex.mutation(internal.embedding.state.forgetAccountEmbeddings, {
        rowIds: rows.map((row) => row.rowId as Id<"cardEmbeddings">),
      });
      if (!withinBudget(startedAt)) {
        return false;
      }
    }
  };

  const deleteRemainingRows = async () => {
    const startedAt = Date.now();
    while (
      await convex.mutation(internal.accountDeletionData.ancillaryPage, binding)
    ) {
      if (!withinBudget(startedAt)) {
        return false;
      }
    }
    return true;
  };

  const runAccountData = async (userId: string) => {
    await untilDone("prepare writers", prepareWritersPage);
    await step.do("begin account data deletion", STAGE_STEP, async () => {
      await convex.mutation(internal.accountDeletion.beginAccountDataDeletion, {
        userId,
      });
      return null;
    });
    await untilDone("drain card storage", drainStorage(["cards", "imports"]));
    await step.do("remove card usage", STAGE_STEP, async () => {
      await convex.mutation(internal.accountDeletion.removeAccountCardUsage, {
        userId,
      });
      return null;
    });
    await untilDone(
      "drain other storage",
      drainStorage(["exports", "uploads", "objects"])
    );
    await untilDone("purge vectors", purgeVectors(userId));
    await untilDone("delete account rows", deleteRemainingRows);
  };

  const recordFailure = (stage: number, error: unknown) => {
    const reason = deletionFailureReason(error);
    return step.do(`record failure ${stage}`, CONVEX_STEP, async () => {
      await convex.mutation(internal.accountDeletionJobs.recordFailure, {
        ...binding,
        stage,
        ...(reason ? { reason } : {}),
      });
      return null;
    });
  };

  return runReported(
    run,
    async () => {
      for (let stage = 0; stage < ACCOUNT_DELETION_STAGES.length; stage += 1) {
        const state = await step.do(`load state ${stage}`, CONVEX_STEP, () =>
          settleConvexErrors(async () => {
            const current = await convex.query(
              internal.accountDeletionJobs.getState,
              binding
            );
            return { stage: current.stage ?? 0, userId: current.userId };
          })
        );
        if (state.stage > stage) {
          continue;
        }
        try {
          if (stage === ACCOUNT_DATA) {
            await runAccountData(state.userId);
          } else {
            await untilDone(`stage ${stage}`, () =>
              convex.action(internal.accountDeletionActions.runStage, {
                ...binding,
                stage,
              })
            );
          }
        } catch (error) {
          await recordFailure(stage, error);
          throw error;
        }
        await step.do(`advance ${stage}`, CONVEX_STEP, async () => {
          await convex.mutation(internal.accountDeletionJobs.advance, {
            ...binding,
            stage,
          });
          return null;
        });
      }
      try {
        await untilDone("finalize", () =>
          convex.mutation(internal.accountDeletionJobs.finalize, binding)
        );
      } catch (error) {
        await recordFailure(ACCOUNT_DELETION_STAGES_DONE, error);
        throw error;
      }
      return null;
    },
    convex
  );
};
