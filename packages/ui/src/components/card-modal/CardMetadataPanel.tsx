import { CARD_TYPE_LABELS, type CardType } from "@teak/convex/shared/constants";
import { normalizeHexColor } from "@teak/convex/shared/utils/colorUtils";
import { badgeVariants } from "@teak/ui/components/ui/badge";
import { Button } from "@teak/ui/components/ui/button";
import { Label } from "@teak/ui/components/ui/label";
import { Spinner } from "@teak/ui/components/ui/spinner";
import {
  Download,
  Edit,
  Heart,
  Info,
  RotateCcw,
  Sparkles,
  Tag,
  Trash,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
import { getCardTypeIconComponent } from "./cardTypeIcon";
import type { CardModalCard, GetCurrentValue } from "./types";

interface CardMetadataPanelProps {
  actions: {
    showMoreInfo: () => void;
    toggleFavorite: () => void;
    openLink?: () => void;
    downloadFile?: () => void;
    showNotesEditor: () => void;
    showTagManager: () => void;
    deleteCard: () => void;
    restoreCard: () => void;
    permanentlyDeleteCard: () => void;
  };
  card: CardModalCard;
  getCurrentValue: GetCurrentValue;
  isDownloading?: boolean;
  onCardTypeClick: () => void;
  onTagClick?: (tag: string) => void;
}

const metadataBadgeClassName = cn(
  badgeVariants({ variant: "outline" }),
  "cursor-pointer gap-2 rounded-full px-3 py-1 text-sm [&_svg]:size-3.5!"
);

export async function copyColorHexToClipboard(hex: string) {
  try {
    await navigator.clipboard.writeText(hex);
    toast.success(`Copied ${hex}`);
  } catch (error) {
    console.error("Failed to copy color", error);
    toast.error("Failed to copy");
  }
}

export function CardMetadataPanel({
  card,
  getCurrentValue,
  onCardTypeClick,
  onTagClick,
  actions,
  isDownloading,
}: CardMetadataPanelProps) {
  const IconComponent = getCardTypeIconComponent(card.type as CardType);
  const uniqueHexes = new Set<string>();

  for (const color of card.colors ?? []) {
    const normalizedHex = normalizeHexColor(color.hex);

    if (normalizedHex) {
      uniqueHexes.add(normalizedHex);
    }
  }

  const paletteHexes = [...uniqueHexes];
  const iconClass = "size-3 md:size-4";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/50 p-4 md:flex-1">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-1 md:gap-5">
        {getCurrentValue("notes") && (
          <div>
            <Label>Notes</Label>
            <p className="mt-1.5 whitespace-pre-wrap rounded-md border bg-background px-3 py-2.5">
              {getCurrentValue("notes")}
            </p>
          </div>
        )}

        {card.aiSummary && (
          <div>
            <Label>Summary</Label>
            <p className="mt-1.5 whitespace-pre-wrap rounded-md border bg-background px-3 py-2.5">
              {getCurrentValue("aiSummary")}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {card.type && (
            <button
              className={metadataBadgeClassName}
              onClick={onCardTypeClick}
              type="button"
            >
              <IconComponent className="size-3.5" />
              {CARD_TYPE_LABELS[card.type as CardType]}
            </button>
          )}

          {card.tags?.map((tag: string) => (
            <button
              className={metadataBadgeClassName}
              key={tag}
              onClick={() => onTagClick?.(tag)}
              type="button"
            >
              {tag}
            </button>
          )) || []}

          {paletteHexes.map((hex) => (
            <button
              aria-label={`Copy ${hex}`}
              className={cn(
                metadataBadgeClassName,
                "group relative overflow-visible px-2"
              )}
              key={hex}
              onClick={() => void copyColorHexToClipboard(hex)}
              type="button"
            >
              <span
                aria-hidden="true"
                className="size-3.5 rounded-full border border-black/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"
                style={{ backgroundColor: hex }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] text-background opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {hex}
              </span>
            </button>
          ))}

          {card.aiTags?.map((tag: string) => (
            <button
              className={metadataBadgeClassName}
              key={`ai-${tag}`}
              onClick={() => onTagClick?.(tag)}
              type="button"
            >
              <Sparkles className="size-3 md:size-4" />
              {tag}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          <PanelButton
            icon={<Info className={iconClass} />}
            onClick={actions.showMoreInfo}
          >
            Info
          </PanelButton>

          <PanelButton
            icon={
              <Heart
                className={cn(
                  iconClass,
                  card.isFavorited
                    ? "fill-destructive text-destructive"
                    : undefined
                )}
              />
            }
            onClick={actions.toggleFavorite}
          >
            {card.isFavorited ? "Unfavorite" : "Favorite"}
          </PanelButton>

          {actions.downloadFile && (
            <PanelButton
              disabled={isDownloading}
              icon={
                isDownloading ? (
                  <Spinner className={iconClass} />
                ) : (
                  <Download className={iconClass} />
                )
              }
              onClick={actions.downloadFile}
            >
              {isDownloading ? "Downloading..." : "Download"}
            </PanelButton>
          )}

          <PanelButton
            icon={<Edit className={iconClass} />}
            onClick={actions.showNotesEditor}
          >
            {getCurrentValue("notes") ? "Edit Notes" : "Add Notes"}
          </PanelButton>

          <PanelButton
            icon={<Tag className={iconClass} />}
            onClick={actions.showTagManager}
          >
            Manage Tags
          </PanelButton>

          {!card.isDeleted && (
            <PanelButton
              icon={<Trash2 className={iconClass} />}
              onClick={actions.deleteCard}
            >
              Delete
            </PanelButton>
          )}

          {card.isDeleted && (
            <>
              <PanelButton
                icon={<RotateCcw className={iconClass} />}
                onClick={actions.restoreCard}
              >
                Restore
              </PanelButton>
              <PanelButton
                icon={<Trash className={iconClass} />}
                onClick={actions.permanentlyDeleteCard}
                variant="destructive"
              >
                Delete Forever
              </PanelButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface PanelButtonProps {
  children: React.ReactNode;
  disabled?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: "outline" | "destructive";
}

const PanelButton = ({
  children,
  disabled,
  icon,
  onClick,
  variant = "outline",
}: PanelButtonProps) => (
  <Button
    className="gap-2"
    disabled={disabled}
    onClick={onClick}
    size="sm"
    variant={variant}
  >
    {icon}
    <span>{children}</span>
  </Button>
);
