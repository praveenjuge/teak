import { CARD_TYPE_LABELS, type CardType } from "@teak/convex/shared/constants";
import { normalizeHexColor } from "@teak/convex/shared/utils/colorUtils";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { Button } from "@teak/ui/components/ui/button";
import { Copy, RotateCcw, Sparkles, Trash, X } from "lucide-react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useFolders } from "../../hooks/useFolders";
import { copyColorHexToClipboard } from "../../lib/clipboard";
import { cn } from "../../lib/utils";
import { CardFoldersDialog } from "../folders/CardFoldersDialog";
import { FolderDot } from "../folders/FolderDot";
import { ShortcutKeys } from "../shortcuts/ShortcutTooltip";
import { type CardDetailField, getCardDetailSections } from "./cardDetails";
import { getCardTypeIconComponent } from "./cardTypeIcon";
import type { CardModalCard, GetCurrentValue } from "./types";

export interface CardTagsControl {
  addTag: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  removeAiTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  setTagInput: (value: string) => void;
  tagInput: string;
}

interface CardMetadataPanelProps {
  card: CardModalCard;
  getCurrentValue: GetCurrentValue;
  notesRef?: RefObject<HTMLTextAreaElement | null>;
  onCardTypeClick: () => void;
  /** Saves edits now, as a field loses focus. */
  onCommit: () => void;
  onNotesChange: (notes: string) => void;
  onPermanentDelete: () => void;
  onRestore: () => void;
  onTagClick?: (tag: string) => void;
  tags: CardTagsControl;
}

const SUMMARY_FOLD_LENGTH = 280;

async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error("Failed to copy");
  }
}

function PanelSection({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <div className="flex h-5 items-center justify-between gap-2">
        <h3 className="font-medium text-muted-foreground text-xs">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function PropertyRow({
  children,
  label,
  title,
}: {
  children: ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right" title={title}>
        {children}
      </dd>
    </div>
  );
}

function DetailRows({ fields }: { fields: CardDetailField[] }) {
  return fields.map(({ label, value }) => (
    <PropertyRow key={label} label={label} title={value}>
      {value}
    </PropertyRow>
  ));
}

const chipRemoveClass =
  "flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground pointer-fine:absolute pointer-fine:-top-1.5 pointer-fine:-right-1.5 pointer-fine:rounded-full pointer-fine:bg-foreground pointer-fine:text-background pointer-fine:opacity-0 pointer-fine:shadow-sm pointer-fine:transition-opacity pointer-fine:hover:bg-foreground pointer-fine:hover:text-background pointer-fine:focus-visible:opacity-100 pointer-fine:group-hover/tag:opacity-100 [&_svg]:size-3 pointer-fine:[&_svg]:size-2.5";

/** The side of the card dialog: notes, summary, tags, folders and facts. */
export function CardMetadataPanel({
  card,
  getCurrentValue,
  notesRef,
  onCardTypeClick,
  onCommit,
  onNotesChange,
  onPermanentDelete,
  onRestore,
  onTagClick,
  tags,
}: CardMetadataPanelProps) {
  const TypeIcon = getCardTypeIconComponent(card.type as CardType);
  const [isFoldersOpen, setIsFoldersOpen] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const folders = useFolders();
  const cardFolderIds = useMemo(
    () => (card.folderIds ?? []) as string[],
    [card.folderIds]
  );
  const cardFolders = useMemo(
    () =>
      (folders ?? []).filter((folder) => cardFolderIds.includes(folder._id)),
    [cardFolderIds, folders]
  );

  const paletteHexes = [
    ...new Set(
      (card.colors ?? [])
        .map((color) => normalizeHexColor(color.hex))
        .filter((hex): hex is string => Boolean(hex))
    ),
  ];
  const userTags = card.tags ?? [];
  const aiTags = (card.aiTags ?? []).filter((tag) => !userTags.includes(tag));
  const summary = getCurrentValue("aiSummary");
  const isLongSummary = (summary?.length ?? 0) > SUMMARY_FOLD_LENGTH;
  const sections = getCardDetailSections(card);
  const safeUrl = sanitizeExternalUrl(card.url);

  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === "Enter" || event.key === ",") && tags.tagInput.trim()) {
      event.preventDefault();
      tags.addTag();
    } else if (
      event.key === "Backspace" &&
      !tags.tagInput &&
      userTags.length > 0
    ) {
      event.preventDefault();
      tags.removeTag(userTags[userTags.length - 1] as string);
    }
  };

  return (
    <div className="space-y-6 px-5 py-5">
      {card.isDeleted && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-foreground/[0.04] py-1.5 pr-1.5 pl-3">
          <p className="text-muted-foreground text-sm">In Trash</p>
          <div className="flex gap-1">
            <Button
              className="h-7 px-2.5"
              onClick={onRestore}
              size="sm"
              variant="ghost"
            >
              <RotateCcw />
              Restore
            </Button>
            <Button
              className="h-7 px-2.5 text-destructive hover:text-destructive"
              onClick={onPermanentDelete}
              size="sm"
              variant="ghost"
            >
              <Trash />
              Delete Forever
            </Button>
          </div>
        </div>
      )}

      <PanelSection title="Notes">
        <div className="relative">
          <textarea
            aria-keyshortcuts={card.isDeleted ? undefined : "N"}
            aria-label="Notes"
            className="peer field-sizing-content -mx-2 block max-h-72 min-h-9 w-[calc(100%+1rem)] resize-none rounded-md bg-transparent px-2 py-1 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-foreground/[0.03] focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring/40"
            dir="auto"
            onBlur={onCommit}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder={card.isDeleted ? "No notes" : "Add a note…"}
            readOnly={card.isDeleted}
            ref={notesRef}
            value={getCurrentValue("notes") ?? ""}
          />
          {!(card.isDeleted || getCurrentValue("notes")) && (
            <ShortcutKeys
              className="pointer-events-none absolute top-2 right-0 peer-focus:hidden max-sm:hidden"
              keys={["N"]}
            />
          )}
        </div>
      </PanelSection>

      {summary && (
        <PanelSection title="Summary">
          <p
            className={cn(
              "whitespace-pre-wrap break-words text-foreground/80 text-sm leading-relaxed",
              isLongSummary && !isSummaryOpen && "line-clamp-4"
            )}
            dir="auto"
          >
            {summary}
          </p>
          {isLongSummary && (
            <button
              className="font-medium text-muted-foreground text-xs hover:text-foreground"
              onClick={() => setIsSummaryOpen((value) => !value)}
              type="button"
            >
              {isSummaryOpen ? "Show less" : "Show more"}
            </button>
          )}
        </PanelSection>
      )}

      {!(card.isDeleted && userTags.length + aiTags.length === 0) && (
        <PanelSection title="Tags">
          <div className="flex flex-wrap items-center gap-1">
            {userTags.map((tag) => (
              <span
                className="group/tag relative inline-flex h-6 max-w-full items-center gap-0.5 rounded-md bg-secondary pointer-fine:pr-2 pr-1 pl-2 text-secondary-foreground text-sm"
                key={tag}
              >
                <button
                  className="truncate hover:underline hover:underline-offset-2"
                  onClick={() => onTagClick?.(tag)}
                  title={`Show cards tagged ${tag}`}
                  type="button"
                >
                  {tag}
                </button>
                {!card.isDeleted && (
                  <button
                    aria-label={`Remove tag ${tag}`}
                    className={chipRemoveClass}
                    onClick={() => tags.removeTag(tag)}
                    type="button"
                  >
                    <X />
                  </button>
                )}
              </span>
            ))}
            {aiTags.map((tag) => (
              <span
                className="group/tag relative inline-flex h-6 max-w-full items-center gap-1 rounded-md pointer-fine:pr-2 pr-1 pl-1.5 text-muted-foreground text-sm ring-1 ring-border ring-inset"
                key={`ai-${tag}`}
              >
                <Sparkles
                  aria-hidden="true"
                  className="size-3 shrink-0 opacity-70"
                />
                <button
                  className="truncate hover:text-foreground hover:underline hover:underline-offset-2"
                  onClick={() => onTagClick?.(tag)}
                  title={`Tag added by Teak. Show cards tagged ${tag}`}
                  type="button"
                >
                  {tag}
                </button>
                {!card.isDeleted && (
                  <button
                    aria-label={`Remove Teak tag ${tag}`}
                    className={chipRemoveClass}
                    onClick={() => tags.removeAiTag(tag)}
                    type="button"
                  >
                    <X />
                  </button>
                )}
              </span>
            ))}
            {!card.isDeleted && (
              <input
                aria-keyshortcuts="T"
                aria-label="Add a tag"
                className="peer h-6 min-w-20 flex-1 rounded-md bg-transparent px-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring/40"
                enterKeyHint="done"
                maxLength={100}
                onChange={(event) => tags.setTagInput(event.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder="Add tag…"
                ref={tags.inputRef}
                value={tags.tagInput}
              />
            )}
            {!(card.isDeleted || tags.tagInput) && (
              <ShortcutKeys
                className="pointer-events-none peer-focus:hidden max-sm:hidden"
                keys={["T"]}
              />
            )}
          </div>
        </PanelSection>
      )}

      {paletteHexes.length > 0 && card.type !== "palette" && (
        <PanelSection title="Colors">
          <div className="flex flex-wrap gap-1.5">
            {paletteHexes.map((hex) => (
              <button
                aria-label={`Copy ${hex}`}
                className="group/swatch relative size-6 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                key={hex}
                onClick={() => void copyColorHexToClipboard(hex)}
                style={{ backgroundColor: hex }}
                title={`Copy ${hex}`}
                type="button"
              />
            ))}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Details">
        <dl className="text-sm">
          {!card.isDeleted && (
            <PropertyRow label="Folders">
              <button
                aria-label={
                  cardFolders.length
                    ? `In ${cardFolders.map((folder) => folder.name).join(", ")}. Change folders`
                    : "Add to a folder"
                }
                className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1 hover:bg-foreground/5"
                onClick={() => setIsFoldersOpen(true)}
                title={cardFolders.map((folder) => folder.name).join(", ")}
                type="button"
              >
                {cardFolders.length > 0 ? (
                  <>
                    <span className="flex shrink-0 -space-x-0.5">
                      {cardFolders.slice(0, 3).map((folder) => (
                        <FolderDot color={folder.color} key={folder._id} />
                      ))}
                    </span>
                    <span className="truncate" dir="auto">
                      {cardFolders.length === 1
                        ? cardFolders[0]?.name
                        : `${cardFolders[0]?.name} +${cardFolders.length - 1}`}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground/70">Add…</span>
                )}
              </button>
            </PropertyRow>
          )}
          <PropertyRow label="Type">
            <button
              className="inline-flex items-center gap-1.5 rounded-md px-1 hover:bg-foreground/5"
              onClick={onCardTypeClick}
              title={`Show all ${CARD_TYPE_LABELS[card.type as CardType] ?? "card"} cards`}
              type="button"
            >
              <TypeIcon className="size-3.5 text-muted-foreground" />
              {CARD_TYPE_LABELS[card.type as CardType] ?? "Card"}
            </button>
          </PropertyRow>
          <DetailRows fields={sections.details} />
          <DetailRows fields={sections.source} />
          <DetailRows fields={sections.camera} />
          {safeUrl && (
            <div className="group/url flex min-h-7 items-center gap-2 pt-1">
              <dt className="sr-only">Link</dt>
              <dd className="min-w-0 flex-1">
                <a
                  className="block truncate text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-2"
                  href={safeUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                  title={card.url}
                >
                  {card.url?.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              </dd>
              <button
                aria-label="Copy link"
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                onClick={() => void copyText(card.url as string, "Copied link")}
                type="button"
              >
                <Copy className="size-3.5" />
              </button>
            </div>
          )}
        </dl>
      </PanelSection>

      <CardFoldersDialog
        cardId={card._id}
        folderIds={cardFolderIds}
        onOpenChange={setIsFoldersOpen}
        open={isFoldersOpen}
      />
    </div>
  );
}
