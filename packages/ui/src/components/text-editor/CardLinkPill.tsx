import type { CardType } from "@teak/convex/shared/constants";
import type { NodeViewProps } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Unlink } from "lucide-react";
import { createContext, useContext } from "react";
import { cn } from "../../lib/utils";
import { getCardTypeIconComponent } from "../card-modal/cardTypeIcon";
import { CardLinkNode } from "./CardLinkNode";
import type { CardLinkTarget } from "./types";

interface CardLinkView {
  onOpenCard?: (cardId: string) => void;
  /** Live titles by card id; absent while they load. */
  targets?: ReadonlyMap<string, CardLinkTarget>;
}

export const CardLinkViewContext = createContext<CardLinkView>({});

export const MISSING_CARD_LABEL = "Missing card";

const PILL_CLASS =
  "mx-px inline-flex max-w-[min(40ch,100%)] items-center gap-1 rounded-full border px-2 align-baseline font-medium text-[0.9em] leading-normal no-underline transition-colors";
const OPEN_PILL_CLASS =
  "cursor-pointer bg-secondary text-secondary-foreground hover:bg-secondary/80";
const MISSING_PILL_CLASS = "cursor-default border-dashed text-muted-foreground";

/** What a pill shows: the card's live title, its stored one, or missing. */
export function cardLinkPillState(
  cardId: string,
  storedTitle: string,
  targets?: ReadonlyMap<string, CardLinkTarget>
) {
  const target = targets?.get(cardId);
  if (target?.missing) {
    return { missing: true, title: MISSING_CARD_LABEL, type: undefined };
  }
  return {
    missing: false,
    title: target?.title || storedTitle || "Card",
    type: (target?.type ?? undefined) as CardType | undefined,
  };
}

function CardLinkPill({ node, selected }: NodeViewProps) {
  const { onOpenCard, targets } = useContext(CardLinkViewContext);
  const cardId = String(node.attrs.cardId);
  const { missing, title, type } = cardLinkPillState(
    cardId,
    String(node.attrs.title),
    targets
  );
  const Icon = missing ? Unlink : getCardTypeIconComponent(type);
  const canOpen = !missing && Boolean(onOpenCard);
  const pillClass = cn(PILL_CLASS, selected && "ring-2 ring-ring/50");
  const label = (
    <>
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate" dir="auto">
        {title}
      </span>
    </>
  );
  return (
    <NodeViewWrapper
      as="span"
      className="card-link-node"
      data-card-link-pill=""
      data-missing={missing ? "" : undefined}
    >
      {canOpen ? (
        <a
          className={cn(pillClass, OPEN_PILL_CLASS)}
          contentEditable={false}
          href={`?card=${encodeURIComponent(cardId)}`}
          onClick={(event) => {
            event.preventDefault();
            onOpenCard?.(cardId);
          }}
          tabIndex={-1}
          title={title}
        >
          {label}
        </a>
      ) : (
        <span
          className={cn(
            pillClass,
            missing ? MISSING_PILL_CLASS : OPEN_PILL_CLASS
          )}
          contentEditable={false}
          title={
            missing ? "This card is in Trash, deleted or not yours" : title
          }
        >
          {label}
        </span>
      )}
    </NodeViewWrapper>
  );
}

/** The pill node with its React view, for the live editor only. */
export const CardLinkPillNode = CardLinkNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CardLinkPill, { as: "span" });
  },
});
