import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";
import { deletePostHogPerson } from "./accountDeletion/analytics";
import {
  ACCOUNT_DELETION_STAGES,
  type AccountDeletionStage,
} from "./accountDeletion/stages";
import { closeBillingCustomer } from "./billing";
import { workosRequest, workosUserPath } from "./shared/workosClient";
import { WORKOS_USER_ID } from "./shared/workosIds";

const deleteWorkosUser = async (workosUserId: string) => {
  if (!WORKOS_USER_ID.test(workosUserId)) {
    throw new Error("deletion_workos_user_id_invalid");
  }
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    throw new Error("deletion_workos_unavailable");
  }
  const response = await workosRequest(workosUserPath(workosUserId), apiKey, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`deletion_workos_user_${response.status}`);
  }
};
interface StageBinding {
  generation: number;
  stateId: Id<"accountDeletionStates">;
}

type StageHandler = (
  ctx: ActionCtx,
  state: Doc<"accountDeletionStates">,
  binding: StageBinding
) => Promise<boolean>;

const STAGE_HANDLERS: Record<AccountDeletionStage, StageHandler> = {
  accessAndBilling: async (ctx, state, binding) => {
    const moreKeys: boolean = await ctx.runMutation(
      internal.accountDeletionJobs.revokeLocalPage,
      binding
    );
    if (moreKeys) {
      return false;
    }
    const consentsDone: boolean = await ctx.runMutation(
      internal.accountDeletionJobs.revokeConsentPage,
      binding
    );
    if (!consentsDone) {
      return false;
    }
    await closeBillingCustomer(ctx, state.userId);
    return true;
  },
  retiredProviderSessions: () => Promise.resolve(true),
  retiredAuthorizedApps: () => Promise.resolve(true),
  accountData: () => {
    throw new Error("deletion_stage_runs_in_files_worker");
  },
  workosUser: async (_ctx, state) => {
    if (state.workosUserId) {
      await deleteWorkosUser(state.workosUserId);
    }
    return true;
  },
  retainedRecordsAndAnalytics: async (_ctx, state) => {
    await deletePostHogPerson(state.userId);
    return true;
  },
};

export const runStage = internalAction({
  args: {
    stateId: v.id("accountDeletionStates"),
    generation: v.number(),
    stage: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, { stage, ...binding }): Promise<boolean> => {
    const state: Doc<"accountDeletionStates"> = await ctx.runQuery(
      internal.accountDeletionJobs.getState,
      binding
    );
    if (state.stage !== stage) {
      throw new Error("stale_deletion_stage");
    }
    const name = ACCOUNT_DELETION_STAGES[stage];
    if (!name) {
      throw new Error("invalid_deletion_stage");
    }
    return await STAGE_HANDLERS[name](ctx, state, binding);
  },
});
