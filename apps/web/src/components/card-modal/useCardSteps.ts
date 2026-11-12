import { useCallback, useEffect, useRef } from "react";

/**
 * Previous and next, one card per press however fast the presses come.
 * `onStep` moves from the card the last step went to, not the card on
 * screen, so a press only waits for the open card to save. Every press
 * counts: presses still waiting add up, so a press the other way takes one
 * back, and a held key's repeats wait for each step to land.
 */
export function useCardSteps({
  cardId,
  onStep,
  open,
  readyToLeave,
}: {
  cardId?: string | null;
  onStep?: (direction: 1 | -1) => void;
  open: boolean;
  readyToLeave: () => Promise<boolean>;
}) {
  const latest = useRef({ cardId, onStep, open, readyToLeave });
  latest.current = { cardId, onStep, open, readyToLeave };
  const queued = useRef(0);
  const running = useRef<boolean>(false);
  // The card on screen when the last step went out, until another shows.
  const landingFrom = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (landingFrom.current !== cardId) {
      landingFrom.current = undefined;
    }
  }, [cardId]);

  useEffect(() => {
    if (!open) {
      queued.current = 0;
      landingFrom.current = undefined;
    }
  }, [open]);

  const run = useCallback(async () => {
    if (running.current) {
      return;
    }
    running.current = true;
    try {
      while (queued.current !== 0) {
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        const ready = await latest.current.readyToLeave();
        // Saving can take a moment, and a closed card stays closed.
        if (!(ready && latest.current.open)) {
          queued.current = 0;
          return;
        }
        // Presses while saving count too: they may have cancelled out.
        if (queued.current !== 0) {
          const direction = Math.sign(queued.current) as 1 | -1;
          queued.current -= direction;
          landingFrom.current = latest.current.cardId ?? null;
          latest.current.onStep?.(direction);
        }
      }
    } finally {
      running.current = false;
    }
  }, []);

  return useCallback(
    (direction: 1 | -1, { repeat = false }: { repeat?: boolean } = {}) => {
      if (repeat && (running.current || landingFrom.current !== undefined)) {
        return;
      }
      queued.current += direction;
      void run();
    },
    [run]
  );
}
