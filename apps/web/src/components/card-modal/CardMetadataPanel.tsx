import { captureEvent } from "@teak/convex/shared/analytics";
import type { CardType } from "@teak/convex/shared/constants";
import { doneActionLabel } from "@teak/convex/shared/linkCategories";
import { isCardHidden } from "@teak/convex/shared/tags";
import { normalizeHexColor } from "@teak/convex/shared/utils/colorUtils";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import {
  hostForDisplay,
  normalizeUrlHost,
} from "@teak/convex/shared/utils/urlHost";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import {
  ChevronDown,
  Circle,
  CircleCheck,
  EyeOff,
  FolderPlus,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { useMemo, useState } from "react";
import { US_ENGLISH_LOCALE } from "@/lib/englishTranslators";
import { useFolders } from "../../hooks/useFolders";
import { useStoredFlag } from "../../hooks/useStoredFlag";
import { copyColorHexToClipboard } from "../../lib/clipboard";
import { isImeComposing } from "../../lib/keyboardShortcuts";
import { cn } from "../../lib/utils";
import { cardTypeLabel } from "../cards/cardTypeLabel";
import { FolderDot } from "../folders/FolderDot";
import { ShortcutKeys, ShortcutTooltip } from "../shortcuts/ShortcutTooltip";
import {
  type CardDetailField,
  getCardDetailSections,
  keyDetailLabels,
} from "./cardDetails";
import { getCardTypeIconComponent } from "./cardTypeIcon";
import type { CardModalCard, GetCurrentValue } from "./types";

export interface CardTagsControl {
  /** Keeps a tag Teak suggested as one of the card's own tags. */
  acceptAiTag?: (tag: string) => void;
  addTag: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  removeAiTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  setTagInput: (value: string) => void;
  tagInput: string;
}

/** Cards whose notes link here with `[[…]]`, and whether there are more. */
export interface CardBacklinks {
  backlinks: { id: string; title: string; type: string }[];
  hasMore: boolean;
}

export interface SavePdfControl {
  isSaving: boolean;
  save: () => void;
}

/** A link's to-do state: read, watched, cooked and so on. */
export interface CardDoneControl {
  category?: string;
  done: boolean;
  onToggle: () => void;
}

interface CardMetadataPanelProps {
  backlinks?: CardBacklinks;
  card: CardModalCard;
  done?: CardDoneControl;
  getCurrentValue: GetCurrentValue;
  notesRef?: RefObject<HTMLTextAreaElement | null>;
  onCardTypeClick: () => void;
  onCommit: () => void;
  onNotesChange: (notes: string) => void;
  onOpenCard?: (cardId: string) => void;
  onOpenFolders?: () => void;
  onTagClick?: (tag: string) => void;
  tags: CardTagsControl;
}

const SUMMARY_FOLD_LENGTH = 140;

export const DETAILS_EXPANDED_KEY = "teak.cardModal.detailsExpanded";

function PanelSection({
  action,
  children,
  icon,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <div className="flex h-5 items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 font-medium text-muted-foreground text-xs">
          {icon}
          {title}
        </h3>
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

/** "Mark as read" and friends, as a pill at the top of the panel. */
export function DoneButton({
  category,
  done,
  onClick,
}: {
  category?: string;
  done: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("cardModal.done");
  const verb = doneActionLabel(category);
  const label = done ? t("state", { verb }) : t("markAs", { verb });
  return (
    <ShortcutTooltip keys={["D"]} label={label} side="left">
      <button
        aria-keyshortcuts="D"
        aria-label={label}
        aria-pressed={done}
        className={cn(
          "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0",
          done
            ? "bg-primary/10 text-primary hover:bg-primary/15"
            : "text-muted-foreground ring-1 ring-border ring-inset hover:bg-foreground/5 hover:text-foreground"
        )}
        onClick={onClick}
        type="button"
      >
        {done ? <CircleCheck /> : <Circle />}
        <span className="truncate">{label}</span>
      </button>
    </ShortcutTooltip>
  );
}

/** "Linked from": the notes that link to this card, newest first. */
export function LinkedFromSection({
  backlinks,
  onOpenCard,
}: {
  backlinks?: CardBacklinks;
  onOpenCard?: (cardId: string) => void;
}) {
  const t = useTranslations("cardModal.panel");
  if (!(backlinks && backlinks.backlinks.length > 0)) {
    return null;
  }
  return (
    <PanelSection title={t("linkedFrom")}>
      <ul className="-mx-1 space-y-0.5">
        {backlinks.backlinks.map((source) => {
          const Icon = getCardTypeIconComponent(source.type as CardType);
          return (
            <li key={source.id}>
              <button
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-foreground/5 disabled:pointer-events-none"
                disabled={!onOpenCard}
                onClick={() => {
                  captureEvent("card_backlink_opened");
                  onOpenCard?.(source.id);
                }}
                title={source.title}
                type="button"
              >
                <Icon
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="truncate" dir="auto">
                  {source.title}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {backlinks.hasMore ? (
        <p className="px-1 text-muted-foreground text-xs">{t("andMore")}</p>
      ) : null}
    </PanelSection>
  );
}

/** Tags Teak added, folded away until someone wants to look. */
function SuggestedTags({
  disabled,
  onAccept,
  onRemove,
  onTagClick,
  tags,
}: {
  disabled: boolean;
  onAccept?: (tag: string) => void;
  onRemove: (tag: string) => void;
  onTagClick?: (tag: string) => void;
  tags: string[];
}) {
  const t = useTranslations("cardModal.panel");
  const [isOpen, setIsOpen] = useState(false);
  if (tags.length === 0) {
    return null;
  }
  return (
    <div className="pt-1">
      <button
        aria-expanded={isOpen}
        className="-mx-1 inline-flex h-6 items-center gap-1 rounded-md px-1 text-muted-foreground text-xs hover:bg-foreground/5 hover:text-foreground"
        onClick={() => setIsOpen((value) => !value)}
        type="button"
      >
        <Sparkles aria-hidden="true" className="size-3" />
        {t("suggestedTags", { count: tags.length })}
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3 transition-transform", isOpen && "rotate-180")}
        />
      </button>
      {isOpen ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              className="group/tag relative inline-flex h-6 max-w-full items-center gap-1 rounded-md pointer-fine:pr-2 pr-1 pl-1.5 text-muted-foreground text-sm outline-dashed outline-1 outline-border -outline-offset-1"
              key={tag}
            >
              {onAccept && !disabled ? (
                <button
                  aria-label={t("keepTag", { tag })}
                  className="inline-flex min-w-0 items-center gap-1 hover:text-foreground"
                  onClick={() => onAccept(tag)}
                  title={t("keepTagHint", { tag })}
                  type="button"
                >
                  <Plus aria-hidden="true" className="size-3 shrink-0" />
                  <span className="truncate" dir="auto">
                    {tag}
                  </span>
                </button>
              ) : (
                <button
                  className="truncate hover:text-foreground hover:underline hover:underline-offset-2"
                  dir="auto"
                  onClick={() => onTagClick?.(tag)}
                  title={t("teakTagHint", { tag })}
                  type="button"
                >
                  {tag}
                </button>
              )}
              {disabled ? null : (
                <button
                  aria-label={t("removeTeakTag", { tag })}
                  className={chipRemoveClass}
                  onClick={() => onRemove(tag)}
                  type="button"
                >
                  <X />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CardMetadataPanel({
  backlinks,
  card,
  done,
  getCurrentValue,
  notesRef,
  onCardTypeClick,
  onCommit,
  onNotesChange,
  onOpenCard,
  onOpenFolders,
  onTagClick,
  tags,
}: CardMetadataPanelProps) {
  const t = useTranslations("cardModal.panel");
  const td = useTranslations("cardModal.details");
  const types = useTranslations("cards.types");
  const exif = useTranslations("lib.exif");
  const clipboard = useTranslations("lib.clipboard");
  const dateLocale = useIntlLocale(US_ENGLISH_LOCALE);
  const TypeIcon = getCardTypeIconComponent(card.type as CardType);
  const typeLabel = cardTypeLabel(card.type, types);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useStoredFlag(DETAILS_EXPANDED_KEY);
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
  const sections = getCardDetailSections(card, {
    exif,
    locale: dateLocale,
    t: td,
  });
  const keyLabels = keyDetailLabels(td);
  const keyDetails = sections.details.filter((field) =>
    keyLabels.has(field.label)
  );
  const moreDetails = [
    ...sections.details.filter((field) => !keyLabels.has(field.label)),
    ...sections.source,
    ...sections.camera,
  ];
  const safeUrl = sanitizeExternalUrl(card.url);
  const safeSourceUrl = sanitizeExternalUrl(card.sourceUrl);
  const sourceHost = normalizeUrlHost(safeSourceUrl);
  const isDeleted = Boolean(card.isDeleted);
  const hasOrganize =
    !isDeleted || userTags.length + aiTags.length + cardFolders.length > 0;

  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(event)) {
      return;
    }
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

  const folderNames = cardFolders.map((folder) => folder.name).join(", ");

  return (
    <div className="space-y-6 px-5 py-5">
      {done && !isDeleted ? (
        <DoneButton
          category={done.category}
          done={done.done}
          onClick={done.onToggle}
        />
      ) : null}

      <PanelSection title={t("notes")}>
        <div className="relative">
          <textarea
            aria-keyshortcuts={isDeleted ? undefined : "N"}
            aria-label={t("notes")}
            className="peer field-sizing-content -mx-2 block max-h-72 min-h-9 w-[calc(100%+1rem)] resize-none rounded-md bg-transparent px-2 py-1 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-foreground/[0.03] focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring/40"
            dir="auto"
            onBlur={onCommit}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder={isDeleted ? t("noNotes") : t("notesPlaceholder")}
            readOnly={isDeleted}
            ref={notesRef}
            value={getCurrentValue("notes") ?? ""}
          />
          {!(isDeleted || getCurrentValue("notes")) && (
            <ShortcutKeys
              className="pointer-events-none absolute top-2 right-0 peer-focus:hidden max-sm:hidden"
              keys={["N"]}
            />
          )}
        </div>
      </PanelSection>

      {hasOrganize ? (
        <PanelSection
          action={
            isCardHidden(card) && (
              <span
                className="inline-flex items-center gap-1 text-muted-foreground text-xs"
                title={t("hiddenHint")}
              >
                <EyeOff aria-hidden="true" className="size-3" />
                {t("hidden")}
              </span>
            )
          }
          title={t("tags")}
        >
          <div className="flex flex-wrap items-center gap-1">
            {cardFolders.length > 0 ? (
              <button
                aria-label={
                  isDeleted
                    ? t("inFolders", { folders: folderNames })
                    : t("inFoldersChange", { folders: folderNames })
                }
                className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md px-2 text-sm ring-1 ring-border ring-inset hover:bg-foreground/5 disabled:pointer-events-none"
                disabled={isDeleted || !onOpenFolders}
                onClick={onOpenFolders}
                title={folderNames}
                type="button"
              >
                <span className="flex shrink-0 -space-x-0.5">
                  {cardFolders.slice(0, 3).map((folder) => (
                    <FolderDot color={folder.color} key={folder._id} />
                  ))}
                </span>
                <span className="truncate" dir="auto">
                  {cardFolders.length === 1
                    ? cardFolders[0]?.name
                    : t("folderOverflow", {
                        count: cardFolders.length - 1,
                        name: cardFolders[0]?.name ?? "",
                      })}
                </span>
              </button>
            ) : null}
            {userTags.map((tag) => (
              <span
                className="group/tag relative inline-flex h-6 max-w-full items-center gap-0.5 rounded-md bg-secondary pointer-fine:pr-2 pr-1 pl-2 text-secondary-foreground text-sm"
                key={tag}
              >
                <button
                  className="truncate hover:underline hover:underline-offset-2"
                  onClick={() => onTagClick?.(tag)}
                  title={t("showTagged", { tag })}
                  type="button"
                >
                  {tag}
                </button>
                {!isDeleted && (
                  <button
                    aria-label={t("removeTag", { tag })}
                    className={chipRemoveClass}
                    onClick={() => tags.removeTag(tag)}
                    type="button"
                  >
                    <X />
                  </button>
                )}
              </span>
            ))}
            {!isDeleted && (
              <span className="flex min-w-24 flex-1 items-center gap-1">
                <input
                  aria-keyshortcuts="T"
                  aria-label={t("addTagLabel")}
                  className="peer h-6 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring/40"
                  enterKeyHint="done"
                  maxLength={100}
                  onChange={(event) => tags.setTagInput(event.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder={t("addTagPlaceholder")}
                  ref={tags.inputRef}
                  value={tags.tagInput}
                />
                {tags.tagInput ? null : (
                  <ShortcutKeys
                    className="pointer-events-none peer-focus:hidden max-sm:hidden"
                    keys={["T"]}
                  />
                )}
                {cardFolders.length === 0 && onOpenFolders ? (
                  <ShortcutTooltip label={t("addToFolder")} side="left">
                    <button
                      aria-label={t("addToFolder")}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground [&_svg]:size-3.5"
                      onClick={onOpenFolders}
                      type="button"
                    >
                      <FolderPlus />
                    </button>
                  </ShortcutTooltip>
                ) : null}
              </span>
            )}
          </div>
          <SuggestedTags
            disabled={isDeleted}
            onAccept={tags.acceptAiTag}
            onRemove={tags.removeAiTag}
            onTagClick={onTagClick}
            tags={aiTags}
          />
        </PanelSection>
      ) : null}

      {summary && (
        <PanelSection
          icon={<Sparkles aria-hidden="true" className="size-3" />}
          title={t("summary")}
        >
          <p
            className={cn(
              "whitespace-pre-wrap break-words text-foreground/80 text-sm leading-relaxed",
              isLongSummary && !isSummaryOpen && "line-clamp-2"
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
              {isSummaryOpen ? t("showLess") : t("showMore")}
            </button>
          )}
        </PanelSection>
      )}

      {paletteHexes.length > 0 && card.type !== "palette" && (
        <PanelSection title={t("colors")}>
          <div className="flex flex-wrap gap-1.5">
            {paletteHexes.map((hex) => (
              <button
                aria-label={t("copyColor", { hex })}
                className="group/swatch relative size-6 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                key={hex}
                onClick={() => void copyColorHexToClipboard(hex, clipboard)}
                style={{ backgroundColor: hex }}
                title={t("copyColor", { hex })}
                type="button"
              />
            ))}
          </div>
        </PanelSection>
      )}

      <PanelSection
        action={
          <button
            className="-mr-1 inline-flex h-5 items-center gap-1 rounded px-1.5 text-muted-foreground text-xs hover:bg-foreground/5 hover:text-foreground"
            onClick={onCardTypeClick}
            title={td("showAllOfType", { type: card.type ?? "card" })}
            type="button"
          >
            <TypeIcon aria-hidden="true" className="size-3" />
            {typeLabel}
          </button>
        }
        title={td("title")}
      >
        <dl className="text-sm">
          {safeSourceUrl && sourceHost ? (
            <PropertyRow label={td("from")}>
              <a
                className="block truncate hover:underline hover:underline-offset-2"
                dir="auto"
                href={safeSourceUrl}
                rel="noopener noreferrer"
                target="_blank"
                // biome-ignore lint/plugin: the saved page's own title and URL.
                title={
                  card.sourceTitle
                    ? `${card.sourceTitle}\n${safeSourceUrl}`
                    : safeSourceUrl
                }
              >
                {hostForDisplay(sourceHost)}
              </a>
            </PropertyRow>
          ) : null}
          {safeUrl ? (
            <PropertyRow label={td("url")}>
              <a
                className="block truncate hover:underline hover:underline-offset-2"
                href={safeUrl}
                rel="noopener noreferrer"
                target="_blank"
                title={card.url}
              >
                {card.url?.replace(/^https?:\/\/(www\.)?/, "")}
              </a>
            </PropertyRow>
          ) : null}
          <DetailRows fields={keyDetails} />
          {isDetailsOpen ? <DetailRows fields={moreDetails} /> : null}
        </dl>
        {moreDetails.length > 0 ? (
          <button
            aria-expanded={isDetailsOpen}
            className="inline-flex items-center gap-1 font-medium text-muted-foreground text-xs hover:text-foreground"
            onClick={() => setIsDetailsOpen((value) => !value)}
            type="button"
          >
            {isDetailsOpen ? td("fewerDetails") : td("moreDetails")}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-3 transition-transform",
                isDetailsOpen && "rotate-180"
              )}
            />
          </button>
        ) : null}
      </PanelSection>

      <LinkedFromSection backlinks={backlinks} onOpenCard={onOpenCard} />
    </div>
  );
}
