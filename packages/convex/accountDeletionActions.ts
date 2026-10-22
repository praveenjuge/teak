"use node";
import { NotFoundException } from "@workos-inc/node";
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
import {
  deleteLegacyBetterAuthRows,
  deleteLegacyBetterAuthSessions,
} from "./legacyBetterAuth";
import { createWorkosClient } from "./shared/workosClient";
import { WORKOS_SESSION_ID, WORKOS_USER_ID } from "./shared/workosIds";
import {
  deleteAuthorizedApp,
  listAuthorizedAppsPage,
} from "./workos/authorizedApps";
import {
  currentWorkosDeletionTarget,
  sameWorkosDeletionTarget,
} from "./workos/deletionCompletion";

const PROVIDER_DELETE_PAGE_SIZE = 10;

const boundWorkos = async (state: Doc<"accountDeletionStates">) => {
  if (!(state.workosUserId && WORKOS_USER_ID.test(state.workosUserId))) {
    throw new Error("deletion_workos_user_id_invalid");
  }
  const target = state.workosTarget;
  const current = await currentWorkosDeletionTarget();
  const apiKey = process.env.WORKOS_API_KEY;
  if (
    !(target && current && apiKey && sameWorkosDeletionTarget(target, current))
  ) {
    throw new Error("deletion_workos_target_unavailable");
  }
  return createWorkosClient(apiKey, target.clientId).userManagement;
};
// One page of the bound user's authorized Connect apps, each revoked. A 404
// with no WorkOS user means there is nothing left to revoke.
async function authorizedApps(state: Doc<"accountDeletionStates">) {
  const users = await boundWorkos(state);
  const workosUserId = state.workosUserId;
  const apiKey = process.env.WORKOS_API_KEY;
  if (!(workosUserId && apiKey)) {
    throw new Error("deletion_workos_target_unavailable");
  }
  const page = await listAuthorizedAppsPage(workosUserId, apiKey, {
    limit: PROVIDER_DELETE_PAGE_SIZE,
    timeoutMs: 30_000,
  });
  if (!page) {
    try {
      await users.getUser(workosUserId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return false;
      }
      throw error;
    }
    throw new Error("deletion_workos_apps_404");
  }
  for (const app of page.apps) {
    await deleteAuthorizedApp(workosUserId, app.id, apiKey, 30_000);
  }
  return page.apps.length > 0;
}
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
  providerSessions: async (ctx, state, binding) => {
    if (state.workosUserId) {
      const client = await boundWorkos(state);
      const previous = state.providerSessionCursor ?? null;
      let sessions: Awaited<ReturnType<typeof client.listSessions>> | undefined;
      try {
        sessions = await client.listSessions(state.workosUserId, {
          limit: PROVIDER_DELETE_PAGE_SIZE,
          after: previous,
          order: "desc",
        });
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          throw error;
        }
        let confirmedAbsent = false;
        try {
          await client.getUser(state.workosUserId);
        } catch (userError) {
          if (!(userError instanceof NotFoundException)) {
            throw userError;
          }
          confirmedAbsent = true;
        }
        if (!confirmedAbsent) {
          throw error;
        }
      }
      if (sessions) {
        if (sessions.data.length > PROVIDER_DELETE_PAGE_SIZE) {
          throw new Error("deletion_session_page_invalid");
        }
        for (const session of sessions.data) {
          if (
            session.userId !== state.workosUserId ||
            !WORKOS_SESSION_ID.test(session.id) ||
            !["active", "expired", "revoked"].includes(session.status)
          ) {
            throw new Error("deletion_session_owner_mismatch");
          }
          if (session.status !== "active") {
            continue;
          }
          try {
            await client.revokeSession({ sessionId: session.id });
          } catch (error) {
            if (!(error instanceof NotFoundException)) {
              throw error;
            }
          }
        }
        const next = sessions.listMetadata.after;
        if (next) {
          if (!WORKOS_SESSION_ID.test(next) || next === previous) {
            throw new Error("deletion_session_cursor_invalid");
          }
          await ctx.runMutation(
            internal.accountDeletionJobs.saveSessionCursor,
            {
              ...binding,
              previous,
              next,
            }
          );
          return false;
        }
      }
    }
    if (state.betterAuthUserId) {
      await deleteLegacyBetterAuthSessions(ctx, state.betterAuthUserId);
    }
    return true;
  },
  authorizedApps: async (_ctx, state) =>
    !(state.workosUserId && (await authorizedApps(state))),
  accountData: () => {
    throw new Error("deletion_stage_runs_in_files_worker");
  },
  workosUser: async (_ctx, state) => {
    if (state.workosUserId) {
      try {
        const users = await boundWorkos(state);
        await users.deleteUser(state.workosUserId);
      } catch (error) {
        if (!(error instanceof NotFoundException)) {
          throw error;
        }
      }
    }
    return true;
  },
  retainedRecordsAndAnalytics: async (ctx, state) => {
    if (state.betterAuthUserId) {
      await deleteLegacyBetterAuthRows(ctx, state.betterAuthUserId);
    }
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
