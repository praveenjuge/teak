import type { ComponentType } from "react";
import {
  Archive,
  ArchiveRestore,
  Circle,
  CircleCheck,
  Copy,
  Heart,
  Pin,
  PinOff,
  RotateCcw,
  SquareCheckBig,
  Tag,
  Trash,
} from "vadivam-react";
import type { ActionCard, CardActionId } from "../../lib/cardActions";
import { cn } from "../../lib/utils";

type IconComponent = ComponentType<{ className?: string }>;

/** The icon each card action shows, for the card's state now. */
export function cardActionIcon(
  action: CardActionId,
  card: ActionCard & { completedAt?: number }
): IconComponent {
  switch (action) {
    case "favorite":
      return Heart;
    case "pin":
      return card.pinPosition === undefined ? Pin : PinOff;
    case "addTags":
      return Tag;
    case "archive":
      return card.isArchived ? ArchiveRestore : Archive;
    case "moveToTrash":
    case "deleteForever":
      return Trash;
    case "restore":
      return RotateCcw;
    case "select":
      return SquareCheckBig;
    case "done":
      return card.completedAt === undefined ? Circle : CircleCheck;
    case "copy":
      return Copy;
    default:
      return action satisfies never;
  }
}

/** A favorite's heart is filled in red. */
export const cardActionIconClass = (
  action: CardActionId,
  card: ActionCard
): string | undefined =>
  action === "favorite" && card.isFavorited
    ? "fill-destructive text-destructive"
    : undefined;

export function CardActionIcon({
  action,
  card,
  className,
}: {
  action: CardActionId;
  card: ActionCard & { completedAt?: number };
  className?: string;
}) {
  const Icon = cardActionIcon(action, card);
  return <Icon className={cn(cardActionIconClass(action, card), className)} />;
}
