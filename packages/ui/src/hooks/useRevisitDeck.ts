import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { SEARCH_MAX_OFFSET, SEARCH_MAX_PAGE_SIZE } from "@teak/convex/shared";
import { captureEvent } from "@teak/convex/shared/analytics";
import { useConvex } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardWithUrls } from "../components/cards/types";
import type { CardsSearchQueryArgs } from "./cardsSearchState";

/** A card as the deck holds it: the grid's card, with its saved date. */
export type RevisitCard = CardWithUrls & Pick<Doc<"cards">, "createdAt">;

/** Cards in one deck. */
export const REVISIT_DECK_SIZE = 20;

/**
 * How far into a view's Shuffle a deck reaches: the cards query pages no
 * further than this offset, so past it "Start over" takes a new seed.
 */
export const REVISIT_WALK_LIMIT = SEARCH_MAX_OFFSET;

export interface RevisitPage {
  continueCursor: string | null;
  isDone: boolean;
  page: RevisitCard[];
}

export type LoadRevisitPage = (cursor: string | null) => Promise<RevisitPage>;

export interface RevisitDeal {
  cards: RevisitCard[];
  /** No unseen card is left in the view (within the walk limit). */
  exhausted: boolean;
}

/**
 * The next deck: the first `REVISIT_DECK_SIZE` cards of the view's Shuffle
 * that aren't in `seen`, read from the first page on. A Shuffle keeps the
 * order of the cards that stay, so after archiving some, these are exactly
 * the next unseen cards; paging on from an offset would skip some, as the
 * view's offsets shift when cards leave it.
 */
export async function dealRevisitCards(
  loadPage: LoadRevisitPage,
  seen: ReadonlySet<string>
): Promise<RevisitDeal> {
  const cards: RevisitCard[] = [];
  const dealt = new Set<string>();
  let cursor: string | null = null;
  let scanned = 0;
  while (scanned < REVISIT_WALK_LIMIT) {
    // Pages follow each other: each needs the cursor before it.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    const { continueCursor, isDone, page } = await loadPage(cursor);
    for (const [index, card] of page.entries()) {
      scanned += 1;
      if (seen.has(card._id) || dealt.has(card._id)) {
        continue;
      }
      dealt.add(card._id);
      cards.push(card);
      if (cards.length === REVISIT_DECK_SIZE) {
        const lastOfView = isDone && index === page.length - 1;
        return { cards, exhausted: lastOfView };
      }
    }
    if (isDone || continueCursor === null || page.length === 0) {
      return { cards, exhausted: true };
    }
    cursor = continueCursor;
  }
  return { cards, exhausted: true };
}

export type RevisitDecision = "archived" | "kept";
export type RevisitMove = "archive" | "back" | "keep";

interface DeckState {
  /** Archived cards, last on top, for Undo. */
  archivedStack: string[];
  cards: RevisitCard[];
  decisions: Readonly<Record<string, RevisitDecision>>;
  exhausted: boolean;
  index: number;
  /** The last step, for the deck's slide. */
  move: RevisitMove | null;
  status: "error" | "loading" | "ready";
}

const LOADING: DeckState = {
  archivedStack: [],
  cards: [],
  decisions: {},
  exhausted: false,
  index: 0,
  move: null,
  status: "loading",
};

const countOf = (
  decisions: DeckState["decisions"],
  decision: RevisitDecision
): number =>
  Object.values(decisions).filter((value) => value === decision).length;

export interface UseRevisitDeckOptions {
  /** Archives a card; resolves false when the archive failed. */
  onArchive: (cardId: string) => Promise<boolean>;
  /** Puts an archived card back; resolves false when that failed. */
  onUnarchive: (cardId: string) => Promise<boolean>;
  /** The view's cards query as a Shuffle of the deck's seed; null waits. */
  queryArgs: CardsSearchQueryArgs | null;
}

export interface RevisitDeck {
  archive: () => Promise<void>;
  archived: number;
  /** Whether Undo (Z) has an archive to take back. */
  canUndo: boolean;
  /** The card on top, from the snapshot; null at the end. */
  current: RevisitCard | null;
  /** True once every card of the deck has been decided. */
  done: boolean;
  /** No unseen card is left: the end screen offers "Start over". */
  exhausted: boolean;
  /** Ends the deck early, reporting how far it got. */
  finish: () => void;
  keep: () => void;
  kept: number;
  /** Deals the next unseen cards of the same seed. */
  more: () => void;
  move: RevisitMove | null;
  /** An archive or undo is on its way; the deck waits for it. */
  pending: boolean;
  /** 1-based place of the current card. */
  position: number;
  retry: () => void;
  status: DeckState["status"];
  total: number;
  undo: () => Promise<void>;
}

/**
 * A Revisit deck over a view: a fixed snapshot of up to 20 cards from its
 * Shuffle, stepped through with Archive and Keep. Cards that leave the view
 * meanwhile stay in the deck; every card shown is remembered, so "20 more"
 * never repeats one. A new seed (or a changed view) starts afresh.
 */
export function useRevisitDeck({
  onArchive,
  onUnarchive,
  queryArgs,
}: UseRevisitDeckOptions): RevisitDeck {
  const convex = useConvex();
  const key = queryArgs ? JSON.stringify(queryArgs) : null;
  const [state, setState] = useState<DeckState>(LOADING);
  // Bumped by "20 more" and Retry; a new key deals on its own.
  const [dealCount, setDealCount] = useState(0);
  const [pending, setPending] = useState(false);
  // Every card dealt for this view and seed.
  const seen = useRef<{ ids: Set<string>; key: string | null }>({
    ids: new Set(),
    key: null,
  });
  const busy = useRef(false);
  // The archive on its way, so a quick Z can wait for it.
  const inFlight = useRef<Promise<boolean> | null>(null);
  // Archived cards, last on top: kept here too, so Z right after an archive
  // sees it before the next render.
  const archivedStack = useRef<string[]>([]);
  // Whether this deal's analytics session was reported.
  const session = useRef<{ finished: boolean } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const report = useCallback((completed: boolean) => {
    const current = session.current;
    if (!current || current.finished) {
      return;
    }
    current.finished = true;
    const { decisions } = stateRef.current;
    captureEvent("revisit_finished", {
      archived: countOf(decisions, "archived"),
      completed,
      kept: countOf(decisions, "kept"),
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: dealCount asks for another deal of the same view.
  useEffect(() => {
    if (key === null) {
      return;
    }
    if (seen.current.key !== key) {
      seen.current = { ids: new Set(), key };
    }
    const seenIds = seen.current.ids;
    const args = JSON.parse(key) as CardsSearchQueryArgs;
    let cancelled = false;
    setState(LOADING);
    const loadPage: LoadRevisitPage = (cursor) =>
      convex.query(api.cards.searchCardsPaginated, {
        ...args,
        paginationOpts: { cursor, numItems: SEARCH_MAX_PAGE_SIZE },
      }) as Promise<RevisitPage>;
    dealRevisitCards(loadPage, seenIds).then(
      ({ cards, exhausted }) => {
        if (cancelled) {
          return;
        }
        for (const card of cards) {
          seenIds.add(card._id);
        }
        archivedStack.current = [];
        setState({ ...LOADING, cards, exhausted, status: "ready" });
        session.current = cards.length > 0 ? { finished: false } : null;
        if (cards.length > 0) {
          captureEvent("revisit_started");
        }
      },
      () => {
        if (!cancelled) {
          setState({ ...LOADING, status: "error" });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [convex, dealCount, key]);

  // Leaving the deck before its end still reports it.
  useEffect(() => () => report(false), [report]);

  const done = state.status === "ready" && state.index >= state.cards.length;
  useEffect(() => {
    if (done) {
      report(true);
    }
  }, [done, report]);

  const keep = useCallback(() => {
    const { cards, index, status } = stateRef.current;
    const card = cards[index];
    if (busy.current || !card || status !== "ready") {
      return;
    }
    setState((prev) => ({
      ...prev,
      decisions: { ...prev.decisions, [card._id]: "kept" },
      index: prev.index + 1,
      move: "keep",
    }));
  }, []);

  const archive = useCallback(async () => {
    const { cards, index, status } = stateRef.current;
    const card = cards[index];
    if (busy.current || !card || status !== "ready") {
      return;
    }
    busy.current = true;
    setPending(true);
    const request = onArchive(card._id).catch(() => false);
    inFlight.current = request;
    const archivedOk = await request;
    inFlight.current = null;
    busy.current = false;
    setPending(false);
    // A failed archive leaves the card on top.
    if (!archivedOk) {
      return;
    }
    archivedStack.current = [...archivedStack.current, card._id];
    const stack = archivedStack.current;
    setState((prev) =>
      prev.cards[prev.index]?._id === card._id
        ? {
            ...prev,
            archivedStack: stack,
            decisions: { ...prev.decisions, [card._id]: "archived" },
            index: prev.index + 1,
            move: "archive",
          }
        : prev
    );
  }, [onArchive]);

  const undo = useCallback(async () => {
    // Z pressed while an archive is on its way takes back that archive.
    if (inFlight.current) {
      await inFlight.current;
    }
    const cardId = archivedStack.current[archivedStack.current.length - 1];
    if (busy.current || cardId === undefined) {
      return;
    }
    busy.current = true;
    setPending(true);
    const restored = await onUnarchive(cardId).catch(() => false);
    busy.current = false;
    setPending(false);
    if (!restored) {
      return;
    }
    archivedStack.current = archivedStack.current.filter((id) => id !== cardId);
    const stack = archivedStack.current;
    setState((prev) => {
      const index = prev.cards.findIndex((card) => card._id === cardId);
      if (index === -1) {
        return prev;
      }
      const { [cardId]: _undone, ...decisions } = prev.decisions;
      return {
        ...prev,
        archivedStack: stack,
        decisions,
        index,
        move: "back",
      };
    });
  }, [onUnarchive]);

  const more = useCallback(() => {
    report(false);
    setDealCount((count) => count + 1);
  }, [report]);

  const retry = useCallback(() => {
    setDealCount((count) => count + 1);
  }, []);

  const finish = useCallback(() => report(false), [report]);

  return useMemo(
    () => ({
      archive,
      archived: countOf(state.decisions, "archived"),
      canUndo: state.archivedStack.length > 0,
      current:
        state.status === "ready" ? (state.cards[state.index] ?? null) : null,
      done,
      exhausted: state.exhausted,
      finish,
      keep,
      kept: countOf(state.decisions, "kept"),
      more,
      move: state.move,
      pending,
      position: Math.min(state.index + 1, state.cards.length),
      retry,
      status: state.status,
      total: state.cards.length,
      undo,
    }),
    [archive, done, finish, keep, more, pending, retry, state, undo]
  );
}
