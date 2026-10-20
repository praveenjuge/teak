export interface GridRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export type GridDirection =
  | "up"
  | "down"
  | "left"
  | "right"
  | "next"
  | "previous";

const EPSILON = 2;

const centerX = (rect: GridRect) => (rect.left + rect.right) / 2;
const centerY = (rect: GridRect) => (rect.top + rect.bottom) / 2;

const overlap = (startA: number, endA: number, startB: number, endB: number) =>
  Math.min(endA, endB) - Math.max(startA, startB) > EPSILON;

export function nextCardIndex(
  rects: readonly GridRect[],
  currentIndex: number,
  direction: GridDirection
): number {
  const current = rects[currentIndex];
  if (!current) {
    return currentIndex;
  }
  if (direction === "next") {
    return Math.min(currentIndex + 1, rects.length - 1);
  }
  if (direction === "previous") {
    return Math.max(currentIndex - 1, 0);
  }

  const vertical = direction === "up" || direction === "down";
  const cx = centerX(current);
  const cy = centerY(current);
  let best = currentIndex;
  let bestScore: [number, number, number] | null = null;

  for (const [index, rect] of rects.entries()) {
    if (index === currentIndex) {
      continue;
    }
    let gap: number;
    if (direction === "down") {
      gap = rect.top - current.bottom;
    } else if (direction === "up") {
      gap = current.top - rect.bottom;
    } else if (direction === "right") {
      gap = rect.left - current.right;
    } else {
      gap = current.left - rect.right;
    }
    if (gap < -EPSILON) {
      continue;
    }
    const inLine = vertical
      ? overlap(rect.left, rect.right, current.left, current.right)
      : overlap(rect.top, rect.bottom, current.top, current.bottom);
    const across = vertical
      ? Math.abs(centerX(rect) - cx)
      : Math.abs(centerY(rect) - cy);
    const score: [number, number, number] = inLine
      ? [0, Math.max(0, gap), across]
      : [1, Math.hypot(centerX(rect) - cx, centerY(rect) - cy), 0];
    if (bestScore === null || compareScores(score, bestScore) < 0) {
      best = index;
      bestScore = score;
    }
  }
  return best;
}

const compareScores = (
  left: [number, number, number],
  right: [number, number, number]
) => {
  for (let index = 0; index < left.length; index++) {
    const difference = left[index] - right[index];
    if (Math.abs(difference) > EPSILON) {
      return difference;
    }
  }
  return 0;
};
