/**
 * The public API operations each SDK member calls. The parity table
 * (scripts/repo/public-parity.ts) reads its SDK column from here, and its
 * test checks every member reaches exactly these. A member missing from the
 * list doesn't compile.
 */
import type { PublicApiOperationId } from "@teak/convex/shared/publicApiContract";
import type { TeakClient } from "./index";

type Members<T> = {
  [K in keyof T & string]: T[K] extends (...args: never[]) => unknown
    ? K
    : `${K}.${keyof T[K] & string}`;
}[keyof T & string];

/** Every client member by its dotted name, and the SDK's own functions that call the API. */
export type SdkMember = Members<TeakClient> | "disconnectConnectGrant";

type Calls = readonly PublicApiOperationId[];

export const SDK_OPERATIONS = {
  "cards.bulk": ["bulkCards"],
  "cards.changes": ["listCardChanges"],
  "cards.content": ["getCardContent"],
  "cards.create": ["createCard"],
  "cards.createFromFile": ["createUpload", "createCard"],
  "cards.createThumbnailUpload": ["createThumbnailUpload"],
  "cards.delete": ["deleteCard"],
  "cards.duplicate": ["findDuplicateCard"],
  "cards.favorites": ["listCards"],
  "cards.get": ["getCard"],
  "cards.links": ["getCard"],
  "cards.list": ["listCards"],
  "cards.pages": ["listCards"],
  "cards.pinned": ["listCards"],
  "cards.refresh": ["refreshCard"],
  "cards.reorderPinned": ["reorderPinnedCards"],
  "cards.resetThumbnail": ["resetCardThumbnail"],
  "cards.restore": ["restoreCard"],
  "cards.savePdf": ["saveCardPdf"],
  "cards.search": ["listCards"],
  "cards.setArchived": ["updateCard"],
  "cards.setDone": ["markCardDone", "unmarkCardDone"],
  "cards.setFavorite": ["setCardFavorite"],
  "cards.setPinned": ["setCardPinned"],
  "cards.setThumbnail": ["createThumbnailUpload", "setCardThumbnail"],
  "cards.similar": ["listCards"],
  "cards.update": ["updateCard"],
  disconnectConnectGrant: ["disconnectOAuthConsent"],
  "exports.latest": ["getLatestExport"],
  "exports.start": ["startExport"],
  "exports.waitFor": ["getLatestExport"],
  "folders.addCards": ["addCardsToFolder"],
  "folders.create": ["createFolder"],
  "folders.delete": ["deleteFolder"],
  "folders.get": ["getFolder"],
  "folders.getRuleRun": ["getFolderRuleRun"],
  "folders.list": ["listFolders"],
  "folders.removeCards": ["removeCardsFromFolder"],
  "folders.undoRuleRun": ["undoFolderRuleRun"],
  "folders.update": ["updateFolder"],
  "folders.waitForRuleRun": ["getFolderRuleRun"],
  "highlights.create": ["createHighlight"],
  "highlights.delete": ["deleteHighlight"],
  "highlights.list": ["listHighlights"],
  "highlights.update": ["updateHighlight"],
  me: ["getMe"],
  "pageSnapshots.createUpload": ["createPageSnapshotUpload"],
  "tags.delete": ["deleteTag"],
  "tags.list": ["listTags"],
  "tags.merge": ["mergeTags"],
  "tags.operation": ["getTagOperation"],
  "tags.rename": ["renameTag"],
  "tags.waitFor": ["getTagOperation"],
  "uploads.create": ["createUpload"],
  // Sends the bytes straight to the signed storage URL; no API operation.
  "uploads.putFile": [],
} as const satisfies Record<SdkMember, Calls>;
