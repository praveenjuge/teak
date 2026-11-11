import { type GenericValidator, type Infer, v } from "convex/values";

const optionalKey = v.optional(v.string());

/**
 * The card fields that name R2 objects the card owns, as the orphan sweep
 * reads them. `cardStorageObjectKeys` reads the same shape, and a test
 * walks `cardValidator` so a new key field can't be left out.
 */
export const cardStorageKeysValidator = v.object({
  article: v.optional(
    v.object({
      status: v.string(),
      textKey: optionalKey,
      imageKeys: v.optional(v.array(v.string())),
    })
  ),
  documentTextKey: optionalKey,
  fileKey: optionalKey,
  metadata: v.optional(
    v.object({
      linkCategory: v.optional(v.object({ rawStorageKey: optionalKey })),
      linkPreview: v.optional(
        v.object({
          rawStorageKey: optionalKey,
          imageStorageKey: optionalKey,
          media: v.optional(
            v.array(
              v.object({
                posterStorageKey: optionalKey,
                storageKey: optionalKey,
              })
            )
          ),
          screenshotStorageKey: optionalKey,
        })
      ),
    })
  ),
  pageArchive: v.optional(v.object({ storageKey: v.string() })),
  pendingPageSnapshotKey: optionalKey,
  previewKey: optionalKey,
  previousThumbnailOverride: v.optional(
    v.object({
      override: v.union(v.object({ storageKey: v.string() }), v.null()),
    })
  ),
  scrubKey: optionalKey,
  thumbnailKey: optionalKey,
  thumbnailOverride: v.optional(v.object({ storageKey: v.string() })),
  workflowArtifactKeys: v.optional(v.array(v.string())),
});

export type CardStorageKeys = Infer<typeof cardStorageKeysValidator>;

const pickDeclared = (validator: GenericValidator, value: unknown): unknown => {
  if (value === undefined || value === null) {
    return value;
  }
  switch (validator.kind) {
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) {
        return undefined;
      }
      const picked: Record<string, unknown> = {};
      for (const [field, fieldValidator] of Object.entries(validator.fields)) {
        const fieldValue = pickDeclared(
          fieldValidator,
          (value as Record<string, unknown>)[field]
        );
        if (fieldValue !== undefined) {
          picked[field] = fieldValue;
        }
      }
      return picked;
    }
    case "array":
      return Array.isArray(value)
        ? value.map((item) => pickDeclared(validator.element, item))
        : undefined;
    case "union": {
      const member = validator.members.find((candidate) =>
        candidate.kind === "object"
          ? typeof value === "object"
          : candidate.kind !== "null"
      );
      return member ? pickDeclared(member, value) : undefined;
    }
    default:
      return value;
  }
};

/** Only the fields of `card` that `cardStorageKeysValidator` declares. */
export const pickCardStorageKeys = (card: CardStorageKeys): CardStorageKeys =>
  pickDeclared(cardStorageKeysValidator, card) as CardStorageKeys;

export const cardStorageObjectKeys = (card: CardStorageKeys): string[] => {
  const linkPreview = card.metadata?.linkPreview;
  return [
    card.fileKey,
    card.fileKey ? `${card.fileKey}.processing.json` : undefined,
    card.thumbnailKey,
    card.scrubKey,
    card.previewKey,
    card.documentTextKey,
    ...(card.workflowArtifactKeys ?? []),
    linkPreview?.rawStorageKey,
    card.metadata?.linkCategory?.rawStorageKey,
    linkPreview?.imageStorageKey,
    linkPreview?.screenshotStorageKey,
    ...(linkPreview?.media ?? []).flatMap((item) => [
      item.storageKey,
      item.posterStorageKey,
    ]),
    card.thumbnailOverride?.storageKey,
    card.previousThumbnailOverride?.override?.storageKey,
    card.pageArchive?.storageKey,
    card.pendingPageSnapshotKey,
    card.article?.textKey,
    ...(card.article?.imageKeys ?? []),
  ].filter((key, index, keys): key is string =>
    Boolean(key && keys.indexOf(key) === index)
  );
};
