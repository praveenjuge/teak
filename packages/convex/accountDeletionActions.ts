"use node";
import { NotFoundException } from "@workos-inc/node";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { runAccountDataDeletion } from "./accountDeletion";
import {
  deleteLegacyBetterAuthRows,
  deleteLegacyBetterAuthSessions,
} from "./legacyBetterAuth";
import { readResponseTextWithinLimit } from "./shared/boundedResponse";
import { workosApiUrl } from "./shared/workosApi";
import { createWorkosClient } from "./shared/workosClient";
import { callFilesWorkerJson } from "./storage/filesWorkerClient";
import { withBackendSpan } from "./telemetry/sentry";
import {
  currentWorkosDeletionTarget,
  sameWorkosDeletionTarget,
} from "./workosDeletionCompletion";

// Keep even a page of slow revocations within the action time limit.
const PROVIDER_DELETE_PAGE_SIZE = 10;

const boundWorkos = async (state: Doc<"accountDeletionStates">) => {
  if (!(state.workosUserId && /^user_[A-Za-z0-9]+$/.test(state.workosUserId))) {
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
// Current Node SDK lacks this supported Management API endpoint. The origin and
// exact bound provider user are fixed, and redirects/oversized responses fail.
async function authorizedApps(state: Doc<"accountDeletionStates">) {
  const users = await boundWorkos(state);
  const workosUserId = state.workosUserId;
  if (!workosUserId) {
    throw new Error("deletion_workos_target_unavailable");
  }
  const url = workosApiUrl(
    `/user_management/users/${encodeURIComponent(workosUserId)}/authorized_applications`
  ).href;
  const response = await fetch(`${url}?limit=${PROVIDER_DELETE_PAGE_SIZE}`, {
    headers: { Authorization: `Bearer ${process.env.WORKOS_API_KEY}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) {
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
  if (!response.ok) {
    throw new Error(`deletion_workos_apps_${response.status}`);
  }
  const body = await readResponseTextWithinLimit(response, 256 * 1024);
  if (body === null) {
    throw new Error("deletion_workos_apps_oversized");
  }
  const payload = JSON.parse(body) as {
    data?: { application?: { id?: string } }[];
  };
  if (
    !Array.isArray(payload.data) ||
    payload.data.length > PROVIDER_DELETE_PAGE_SIZE
  ) {
    throw new Error("deletion_workos_apps_invalid");
  }
  for (const entry of payload.data) {
    const id = entry.application?.id;
    // WorkOS currently returns connect_app_; its API reference also documents conn_app_.
    if (!(id && /^(?:connect_app_|conn_app_)[A-Za-z0-9]+$/.test(id))) {
      throw new Error("deletion_workos_apps_invalid");
    }
    const result = await fetch(`${url}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${process.env.WORKOS_API_KEY}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!result.ok && result.status !== 404) {
      throw new Error(`deletion_workos_apps_${result.status}`);
    }
  }
  return payload.data.length > 0;
}
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
    if (stage === 0) {
      const moreKeys: boolean = await ctx.runMutation(
        internal.accountDeletionJobs.revokeLocalPage,
        binding
      );
      if (moreKeys) {
        return false;
      }
      return await ctx.runMutation(
        internal.accountDeletionJobs.revokeConsentPage,
        binding
      );
    }
    if (stage === 1) {
      if (state.workosUserId) {
        const client = await boundWorkos(state);
        const previous = state.providerSessionCursor ?? null;
        let sessions:
          | Awaited<ReturnType<typeof client.listSessions>>
          | undefined;
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
              !/^session_[A-Za-z0-9]+$/.test(session.id) ||
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
            if (!/^session_[A-Za-z0-9]+$/.test(next) || next === previous) {
              throw new Error("deletion_session_cursor_invalid");
            }
            await ctx.runMutation(
              internal.accountDeletionJobs.saveSessionCursor,
              { ...binding, previous, next }
            );
            return false;
          }
        }
      }
      if (state.betterAuthUserId) {
        await deleteLegacyBetterAuthSessions(ctx, state.betterAuthUserId);
      }
    } else if (stage === 2) {
      if (state.workosUserId && (await authorizedApps(state))) {
        return false;
      }
    } else if (stage === 3) {
      if (
        !(await ctx.runAction(
          internal.accountDeletionData.prepareWriters,
          binding
        ))
      ) {
        return false;
      }
      const data = await runAccountDataDeletion(ctx, state.userId, {
        boundedDeletion: binding,
        observe: withBackendSpan,
        deleteImportObjects: async (objects) => {
          for (const object of objects) {
            if (object.uploadId) {
              const abort = await callFilesWorkerJson({
                op: "abort-multipart",
                params: { key: object.sourceKey, uploadId: object.uploadId },
              });
              if (abort.kind !== "ok") {
                throw new Error("deletion_import_abort_failed");
              }
            }
            await ctx.runAction(internal.accountDeletionData.deleteKeys, {
              keys: [
                object.sourceKey,
                ...(object.reportKey ? [object.reportKey] : []),
              ],
            });
          }
        },
      });
      if (!("done" in data && data.done)) {
        return false;
      }
      return await ctx.runAction(
        internal.accountDeletionData.deleteRemainingData,
        binding
      );
    } else if (stage === 4) {
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
    } else if (stage === 5) {
      if (state.betterAuthUserId) {
        await deleteLegacyBetterAuthRows(ctx, state.betterAuthUserId);
      }
    } else {
      throw new Error("invalid_deletion_stage");
    }
    return true;
  },
});
