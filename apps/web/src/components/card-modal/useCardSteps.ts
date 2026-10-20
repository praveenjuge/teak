import { useCallback, useEffect, useRef } from "react";

/** A step that never lands (the card didn't change) stops waiting after this. */
export const STEP_LANDING_TIMEOUT_MS = 1500;

/**
 * Previous and next, one card per press however fast the presses come.
 * `onNext` and `onPrevious` point at the neighbors of the card on screen, so
 * a second press before that card changes would land on the same card again.
 * Presses queue instead, and each waits for the one before it to land. A press
 * the other way drops the queue, and a held key's repeats never pile up.
 */
export function useCardSteps({
  cardId,
  onNext,
  onPrevious,
  open,
  readyToLeave,
}: {
  cardId?: string | null;
  onNext?: () => void;
  onPrevious?: () => void;
  open: boolean;
  readyToLeave: () => Promise<boolean>;
}) {
  const latest = useRef({ cardId, onNext, onPrevious, open, readyToLeave });
  latest.current = { cardId, onNext, onPrevious, open, readyToLeave };
  const queued = useRef(0);
  // The card a step left from, while that step is on its way.
  const leaving = useRef<string | null | undefined>(undefined);
  const timeout = useRef<number | undefined>(undefined);

  const settle = useCallback(() => {
    leaving.current = undefined;
    window.clearTimeout(timeout.current);
  }, []);

  const flush = useCallback(async () => {
    if (leaving.current !== undefined) {
      return;
    }
    const direction = Math.sign(queued.current);
    const show =
      direction > 0 ? latest.current.onNext : latest.current.onPrevious;
    if (direction === 0 || !show) {
      queued.current = 0;
      return;
    }
    leaving.current = latest.current.cardId ?? null;
    const ready = await latest.current.readyToLeave();
    // Saving can take a moment. A press the other way meanwhile drops this
    // step too, since it hasn't shown yet, and a closed card stays closed.
    if (
      !(ready && latest.current.open) ||
      Math.sign(queued.current) !== direction
    ) {
      settle();
      if (ready && latest.current.open) {
        void flush();
      } else {
        queued.current = 0;
      }
      return;
    }
    queued.current -= direction;
    timeout.current = window.setTimeout(() => {
      queued.current = 0;
      leaving.current = undefined;
    }, STEP_LANDING_TIMEOUT_MS);
    show();
  }, [settle]);

  useEffect(() => {
    if (leaving.current !== undefined && leaving.current !== cardId) {
      settle();
      void flush();
    }
  }, [cardId, flush, settle]);

  useEffect(() => {
    if (!open) {
      queued.current = 0;
      settle();
    }
    return () => window.clearTimeout(timeout.current);
  }, [open, settle]);

  return useCallback(
    (direction: 1 | -1, { repeat = false }: { repeat?: boolean } = {}) => {
      if (repeat && leaving.current !== undefined) {
        return;
      }
      if (Math.sign(queued.current) === -direction) {
        queued.current = 0;
      }
      queued.current += direction;
      void flush();
    },
    [flush]
  );
}
