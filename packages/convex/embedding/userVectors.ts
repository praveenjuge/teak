import { vectorNamespaceForUser } from "@teak/files-protocol";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { getR2KeyPrefix } from "../storage/r2Keys";

export const userVectorNamespace = (userId: string): string | null =>
  vectorNamespaceForUser(`${getR2KeyPrefix()}${userId}`);

export type UserVectorShard =
  | { kind: "never_embedded" }
  | { kind: "assigned"; shard: number };

export const readUserVectorShard = async (
  ctx: ActionCtx,
  userId: string
): Promise<UserVectorShard> => {
  const shard: number | null = await ctx.runQuery(
    internal.vectorShards.getUserShard,
    { userId }
  );
  return shard === null
    ? { kind: "never_embedded" }
    : { kind: "assigned", shard };
};
