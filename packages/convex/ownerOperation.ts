/**
 * An owner operation is one thing a person can do to their own data, defined
 * once: its arguments, its result and a handler that gets the owner's id.
 * Each surface registers it with its own way of finding the owner:
 *
 * - `sessionQuery` / `sessionMutation`: the web and native apps, for the
 *   signed-in session.
 * - `apiQuery` / `apiMutation`: the public API's internal functions, which
 *   take the credential's owner as `userId` and end in `ForUser`.
 */
import type {
  Infer,
  ObjectType,
  PropertyValidators,
  Validator,
} from "convex/values";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import {
  getSessionUser,
  requireSessionUserId,
  requireTeakUserId,
  type TeakUserId,
} from "./securitySessions";

/** Which surface called: the signed-in apps, or the public API and MCP. */
export type OwnerSurface = "app" | "api";

// biome-ignore lint/suspicious/noExplicitAny: any result validator.
type ReturnsValidator = Validator<any, "required", any>;

export interface OwnerOperation<
  Ctx,
  Args extends PropertyValidators,
  Returns extends ReturnsValidator,
> {
  args: Args;
  handler: (
    ctx: Ctx,
    ownerId: TeakUserId,
    args: ObjectType<Args>,
    surface: OwnerSurface
  ) => Promise<Infer<Returns>>;
  returns: Returns;
}

export const ownerQuery = <
  Args extends PropertyValidators,
  Returns extends ReturnsValidator,
>(
  operation: OwnerOperation<QueryCtx, Args, Returns>
) => operation;

export const ownerMutation = <
  Args extends PropertyValidators,
  Returns extends ReturnsValidator,
>(
  operation: OwnerOperation<MutationCtx, Args, Returns>
) => operation;

/** The app's query: `signedOut` answers when no one is signed in. */
export const sessionQuery = <
  Args extends PropertyValidators,
  Returns extends ReturnsValidator,
>(
  operation: OwnerOperation<QueryCtx, Args, Returns>,
  signedOut: Infer<Returns>
) =>
  query({
    args: operation.args,
    returns: operation.returns,
    handler: async (ctx, args: ObjectType<Args>): Promise<Infer<Returns>> => {
      const user = await getSessionUser(ctx);
      return user
        ? await operation.handler(ctx, user.teakUserId, args, "app")
        : signedOut;
    },
  });

/**
 * The app's mutation. Without `signedOut` it refuses a caller who isn't
 * signed in; with it, it answers that instead.
 */
export const sessionMutation = <
  Args extends PropertyValidators,
  Returns extends ReturnsValidator,
>(
  operation: OwnerOperation<MutationCtx, Args, Returns>,
  options: { signedOut?: Infer<Returns> } = {}
) =>
  mutation({
    args: operation.args,
    returns: operation.returns,
    handler: async (ctx, args: ObjectType<Args>): Promise<Infer<Returns>> => {
      if ("signedOut" in options) {
        const user = await getSessionUser(ctx);
        return user
          ? await operation.handler(ctx, user.teakUserId, args, "app")
          : (options.signedOut as Infer<Returns>);
      }
      return await operation.handler(
        ctx,
        await requireSessionUserId(ctx),
        args,
        "app"
      );
    },
  });

const ownerArgs = <Args extends PropertyValidators>(args: Args) => ({
  ...args,
  userId: v.string(),
});

// A public API function's arguments carry the owner as `userId`.
const runForOwner = async <
  Ctx extends QueryCtx,
  Args extends PropertyValidators,
  Returns extends ReturnsValidator,
>(
  operation: OwnerOperation<Ctx, Args, Returns>,
  ctx: Ctx,
  owned: unknown
): Promise<Infer<Returns>> => {
  const { userId, ...args } = owned as ObjectType<Args> & { userId: string };
  return await operation.handler(
    ctx,
    await requireTeakUserId(ctx, userId),
    args as unknown as ObjectType<Args>,
    "api"
  );
};

/** The public API's internal query, for the owner in `userId`. */
export const apiQuery = <
  Args extends PropertyValidators,
  Returns extends ReturnsValidator,
>(
  operation: OwnerOperation<QueryCtx, Args, Returns>
) =>
  internalQuery({
    args: ownerArgs(operation.args),
    returns: operation.returns,
    handler: (ctx, owned): Promise<Infer<Returns>> =>
      runForOwner(operation, ctx, owned),
  });

/** The public API's internal mutation, for the owner in `userId`. */
export const apiMutation = <
  Args extends PropertyValidators,
  Returns extends ReturnsValidator,
>(
  operation: OwnerOperation<MutationCtx, Args, Returns>
) =>
  internalMutation({
    args: ownerArgs(operation.args),
    returns: operation.returns,
    handler: (ctx, owned): Promise<Infer<Returns>> =>
      runForOwner(operation, ctx, owned),
  });
