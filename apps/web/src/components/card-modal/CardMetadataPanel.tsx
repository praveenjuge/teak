import { CARD_TYPE_LABELS, type CardType } from "@teak/convex/shared/constants";
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
import { useMemo } from "react";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getCardTypeIconComponent } from "./cardTypeIcon";
import type { CardModalCard, GetCurrentValue } from "./types";

interface CardMetadataPanelProps {
  card: CardModalCard;
  getCurrentValue: GetCurrentValue;
  onCardTypeClick: () => void;
  onTagClick?: (tag: string) => void;
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
}

export function CardMetadataPanel({
  card,
  getCurrentValue,
  onCardTypeClick,
  onTagClick,
  actions,
}: CardMetadataPanelProps) {
  const IconComponent = useMemo(
    () => getCardTypeIconComponent(card.type as CardType),
    [card.type]
  );
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
              className={cn(
                badgeVariants({ variant: "outline" }),
                "cursor-pointer gap-2 rounded-full px-3 py-1 text-sm [&_svg]:size-3.5!"
              )}
              onClick={onCardTypeClick}
              type="button"
            >
              <IconComponent className="size-3.5" />
              {CARD_TYPE_LABELS[card.type as CardType]}
            </button>
          )}

          {card.tags?.map((tag: string) => (
            <button
              className={cn(
                badgeVariants({ variant: "outline" }),
                "cursor-pointer gap-2 rounded-full px-3 py-1 text-sm [&_svg]:size-3.5!"
              )}
              key={tag}
              onClick={() => onTagClick?.(tag)}
              type="button"
            >
              {tag}
            </button>
          )) || []}

          {card.aiTags?.map((tag: string) => (
            <button
              className={cn(
                badgeVariants({ variant: "outline" }),
                "cursor-pointer gap-2 rounded-full px-3 py-1 text-sm [&_svg]:size-3.5!"
              )}
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
              icon={<Download className={iconClass} />}
              onClick={actions.downloadFile}
            >
              Download
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
  icon: React.ReactNode;
  onClick: () => void;
  variant?: "outline" | "destructive";
}

const PanelButton = ({
  children,
  icon,
  onClick,
  variant = "outline",
}: PanelButtonProps) => (
  <Button className="gap-2" onClick={onClick} size="sm" variant={variant}>
    {icon}
    <span>{children}</span>
  </Button>
);
