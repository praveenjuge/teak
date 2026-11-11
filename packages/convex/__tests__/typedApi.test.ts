import { expectTypeOf, test } from "bun:test";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { api, internal } from "../index.client";

// `typecheck` fails these, not the test run: a Convex module that re-exports
// `api` turns every function reference into `any` (see `index.client.ts`).
test("the package's api and internal are typed", () => {
  expectTypeOf(api).not.toBeAny();
  expectTypeOf(internal).not.toBeAny();
  expectTypeOf(api.cards.searchCardsPaginated).not.toBeAny();
  expectTypeOf(api.cards.searchCardsPaginated).toMatchTypeOf<
    FunctionReference<"query", "public">
  >();
  expectTypeOf<
    FunctionArgs<typeof api.cards.searchCardsPaginated>
  >().not.toBeAny();
  expectTypeOf<
    FunctionReturnType<typeof api.cards.searchCardsPaginated>
  >().not.toBeAny();
  expectTypeOf(internal.publicApi.cardsForUser.quickSaveForUser).not.toBeAny();
});
