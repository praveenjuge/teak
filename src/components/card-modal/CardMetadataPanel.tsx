import { Button } from "@/components/ui/button";
import { badgeVariants } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { CARD_TYPE_LABELS, type CardType } from "@teak/convex/shared/constants";
import { cn } from "@/lib/utils";
import {
  Download,
  Edit,
  ExternalLink,
  Heart,
  Info,
  RotateCcw,
  Sparkles,
  Tag,
  Trash,
  Trash2,
} from "lucide-react";
import type { CardModalCard, GetCurrentValue } from "./types";
import { getCardTypeIconComponent } from "./cardTypeIcon";

type CardMetadataPanelProps = {
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
};

export function CardMetadataPanel({
  card,
  getCurrentValue,
  onCardTypeClick,
  onTagClick,
  actions,
}: CardMetadataPanelProps) {
  const IconComponent = getCardTypeIconComponent(card.type as CardType);
  const iconClass = "size-3 md:size-4";

  return (
    <div className="flex-1 md:flex-1 flex flex-col overflow-hidden min-h-0 p-4 bg-muted/50">
      <div className="flex-1 overflow-y-auto px-1 gap-3 md:gap-5 flex flex-col">
        {getCurrentValue("notes") && (
          <div>
            <Label>Notes</Label>
            <p className="mt-1.5 px-3 py-2.5 bg-background rounded-md border whitespace-pre-wrap">
              {getCurrentValue("notes")}
            </p>
          </div>
        )}

        {card.aiSummary && (
          <div>
            <Label>Summary</Label>
            <p className="mt-1.5 px-3 py-2.5 bg-background rounded-md border whitespace-pre-wrap">
              {getCurrentValue("aiSummary")}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {card.type && (
            <button
              onClick={onCardTypeClick}
              className={cn(
                badgeVariants({ variant: "outline" }),
                "cursor-pointer rounded-full px-3 py-1 gap-2 text-sm [&_svg]:size-3.5!"
              )}
            >
              <IconComponent className="size-3.5" />
              {CARD_TYPE_LABELS[card.type as CardType]}
            </button>
          )}

          {card.tags?.map((tag: string) => (
            <button
              key={tag}
              onClick={() => onTagClick?.(tag)}
              className={cn(
                badgeVariants({ variant: "outline" }),
                "cursor-pointer rounded-full px-3 py-1 gap-2 text-sm [&_svg]:size-3.5!"
              )}
            >
              {tag}
            </button>
          )) || []}

          {card.aiTags?.map((tag: string) => (
            <button
              key={`ai-${tag}`}
              onClick={() => onTagClick?.(tag)}
              className={cn(
                badgeVariants({ variant: "outline" }),
                "cursor-pointer rounded-full px-3 py-1 gap-2 text-sm [&_svg]:size-3.5!"
              )}
            >
              <Sparkles className="size-3 md:size-4" />
              {tag}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          <PanelButton
            onClick={actions.showMoreInfo}
            icon={<Info className={iconClass} />}
          >
            Info
          </PanelButton>

          <PanelButton
            onClick={actions.toggleFavorite}
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
          >
            {card.isFavorited ? "Unfavorite" : "Favorite"}
          </PanelButton>

          {actions.openLink && (
            <PanelButton
              onClick={actions.openLink}
              icon={<ExternalLink className={iconClass} />}
            >
              Open Link
            </PanelButton>
          )}

          {actions.downloadFile && (
            <PanelButton
              onClick={actions.downloadFile}
              icon={<Download className={iconClass} />}
            >
              Download
            </PanelButton>
          )}

          <PanelButton
            onClick={actions.showNotesEditor}
            icon={<Edit className={iconClass} />}
          >
            {getCurrentValue("notes") ? "Edit Notes" : "Add Notes"}
          </PanelButton>

          <PanelButton
            onClick={actions.showTagManager}
            icon={<Tag className={iconClass} />}
          >
            Manage Tags
          </PanelButton>

          {!card.isDeleted && (
            <PanelButton
              onClick={actions.deleteCard}
              icon={<Trash2 className={iconClass} />}
            >
              Delete
            </PanelButton>
          )}

          {card.isDeleted && (
            <>
              <PanelButton
                onClick={actions.restoreCard}
                icon={<RotateCcw className={iconClass} />}
              >
                Restore
              </PanelButton>
              <PanelButton
                onClick={actions.permanentlyDeleteCard}
                icon={<Trash className={iconClass} />}
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

type PanelButtonProps = {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: "outline" | "destructive";
};

const PanelButton = ({
  children,
  icon,
  onClick,
  variant = "outline",
}: PanelButtonProps) => (
  <Button variant={variant} size="sm" onClick={onClick} className="gap-2">
    {icon}
    <span>{children}</span>
  </Button>
);
