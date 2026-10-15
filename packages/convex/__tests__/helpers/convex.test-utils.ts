import type {
  DefaultFunctionArgs,
  FunctionVisibility,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery,
} from "convex/server";
import type { Doc, Id, TableNames } from "../../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../../_generated/server";

export const noop = (): undefined => undefined;

export const testId = <Table extends TableNames>(
  _table: Table,
  id: string
): Id<Table> => id as Id<Table>;

export const testDoc = <Table extends TableNames>(
  _table: Table,
  fields: Partial<Doc<Table>>
): Doc<Table> => fields as Doc<Table>;

// A mock may provide any subset of the real context's members, with whatever
// shape the code under test reads from them.
type MockOf<Ctx> = { [Key in keyof Ctx]?: unknown };

export const mockQueryCtx = (ctx: MockOf<QueryCtx>): QueryCtx =>
  ctx as unknown as QueryCtx;

export const mockMutationCtx = (ctx: MockOf<MutationCtx>): MutationCtx =>
  ctx as unknown as MutationCtx;

export const mockActionCtx = (ctx: MockOf<ActionCtx>): ActionCtx =>
  ctx as unknown as ActionCtx;

export function handlerOf<
  Visibility extends FunctionVisibility,
  Args extends DefaultFunctionArgs,
  Returns,
>(
  fn: RegisteredQuery<Visibility, Args, Returns>
): (ctx: QueryCtx, args: Args) => Returns;
export function handlerOf<
  Visibility extends FunctionVisibility,
  Args extends DefaultFunctionArgs,
  Returns,
>(
  fn: RegisteredMutation<Visibility, Args, Returns>
): (ctx: MutationCtx, args: Args) => Returns;
export function handlerOf<
  Visibility extends FunctionVisibility,
  Args extends DefaultFunctionArgs,
  Returns,
>(
  fn: RegisteredAction<Visibility, Args, Returns>
): (ctx: ActionCtx, args: Args) => Returns;
export function handlerOf(fn: unknown) {
  return (fn as { _handler: unknown })._handler;
}

type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

// Bun's `typeof fetch` also carries `preconnect`; the stub keeps the mock's
// own call log.
export const asFetch = <Impl extends FetchImpl>(
  impl: Impl
): Impl & typeof fetch =>
  Object.assign(impl, { preconnect: noop }) as Impl & typeof fetch;
