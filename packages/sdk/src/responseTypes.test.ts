/**
 * The SDK's response types against what the API's serializers return
 * (packages/convex/publicApi/http/serializers.ts). The checks are types:
 * `bun run typecheck` fails when the API sends a field the SDK doesn't
 * declare, the SDK declares one the API never sends, or a field's type
 * disagrees. The test below only makes the file part of the test run.
 */
import { expect, test } from "bun:test";
import type {
  serializeCard,
  serializeFolder,
  serializeFolderRuleRun,
  serializeHighlight,
  serializeListCard,
} from "@teak/convex/publicApi/http/serializers";
import type {
  Card,
  CardListItem,
  Folder,
  FolderRuleRun,
  Highlight,
} from "./index";

type IsNever<T> = [T] extends [never] ? true : false;
/** The same keys on both sides. */
type SameKeys<A, B> =
  IsNever<Exclude<keyof A, keyof B>> extends true
    ? IsNever<Exclude<keyof B, keyof A>>
    : false;
/** What the API sends fits the SDK's type. */
type Fits<Api, Sdk> = Api extends Sdk ? true : false;

type ApiCard = ReturnType<typeof serializeCard>;
type ApiListCard = ReturnType<typeof serializeListCard>;
type ApiFolder = ReturnType<typeof serializeFolder>;
type ApiRuleRun = ReturnType<typeof serializeFolderRuleRun>;
type ApiHighlight = ReturnType<typeof serializeHighlight>;

const checks = {
  cardKeys: true as SameKeys<ApiCard, Card>,
  cardFits: true as Fits<ApiCard, Card>,
  listCardFits: true as Fits<ApiListCard, CardListItem>,
  // The API's folder kind and statuses are plain strings; the SDK names them.
  folderKeys: true as SameKeys<ApiFolder, Folder>,
  ruleRunKeys: true as SameKeys<ApiRuleRun, FolderRuleRun>,
  highlightKeys: true as SameKeys<ApiHighlight, Highlight>,
  highlightFits: true as Fits<ApiHighlight, Highlight>,
} satisfies Record<string, true>;

test("the SDK's response types match the API's serializers", () => {
  expect(Object.values(checks).every(Boolean)).toBe(true);
});
