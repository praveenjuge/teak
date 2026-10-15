interface CardOpenOrigin {
  at: number;
  cardId: string;
  x: number;
  y: number;
}

const ORIGIN_TTL_MS = 2000;

let lastOrigin: CardOpenOrigin | null = null;

export function rememberCardOpenOrigin(
  cardId: string,
  rect: Pick<DOMRect, "height" | "left" | "top" | "width">
) {
  lastOrigin = {
    at: Date.now(),
    cardId,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

/**
 * The card's centre as a CSS `transform-origin` for a dialog that fills most
 * of the viewport, or undefined when this card has no recent origin.
 */
export function readCardOpenOrigin(
  cardId: string,
  viewport: { height: number; width: number }
): string | undefined {
  const origin = lastOrigin;
  if (
    !origin ||
    origin.cardId !== cardId ||
    Date.now() - origin.at > ORIGIN_TTL_MS ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return;
  }
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  const x = clamp((origin.x / viewport.width) * 100);
  const y = clamp((origin.y / viewport.height) * 100);
  return `${x.toFixed(1)}% ${y.toFixed(1)}%`;
}
