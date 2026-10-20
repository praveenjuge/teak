import { api } from "@teak/convex";
import type { Doc } from "@teak/convex/_generated/dataModel";
import { SEARCH_MAX_OFFSET, SEARCH_MAX_PAGE_SIZE } from "@teak/convex/shared";
import { captureEvent } from "@teak/convex/shared/analytics";
import { useConvex } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardWithUrls } from "../components/cards/types";
import type { CardsSearchQueryArgs } from "../lib/cardsSearchState";

export type RevisitCard = CardWithUrls & Pick<Doc<"cards">, "createdAt">;

export const REVISIT_DECK_SIZE = 20;

export const REVISIT_WALK_LIMIT = SEARCH_MAX_OFFSET;

export const REVISIT_MAX_REQUESTS = 60;

export interface RevisitPage {
  continueCursor: string | null;
  isDone: boolean;
  page: RevisitCard[];
}

export type LoadRevisitPage = (cursor: string | null) => Promise<RevisitPage>;

export interface RevisitDeal {
  cards: RevisitCard[];
  exhausted: boolean;
}

export async function dealRevisitCards(
  loadPage: LoadRevisitPage,
  seen: ReadonlySet<string>
): Promise<RevisitDeal> {
  const cards: RevisitCard[] = [];
  const dealt = new Set<string>();
  let cursor: string | null = null;
  let scanned = 0;
  for (
    let requests = 0;
    scanned < REVISIT_WALK_LIMIT && requests < REVISIT_MAX_REQUESTS;
    requests += 1
  ) {
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
    if (isDone || continueCursor === null) {
      return { cards, exhausted: true };
    }
    cursor = continueCursor;
  }
  return { cards, exhausted: true };
}

export type RevisitDecision = "archived" | "kept";
export type RevisitMove = "archive" | "back" | "keep";

interface DeckState {
  archivedStack: string[];
  cards: RevisitCard[];
  decisions: Readonly<Record<string, RevisitDecision>>;
  exhausted: boolean;
  index: number;
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
  onArchive: (cardId: string) => Promise<boolean>;
  onUnarchive: (cardId: string) => Promise<boolean>;
  queryArgs: CardsSearchQueryArgs | null;
}

export interface RevisitDeck {
  archive: () => Promise<void>;
  archived: number;
  canUndo: boolean;
  current: RevisitCard | null;
  done: boolean;
  exhausted: boolean;
  finish: () => void;
  keep: () => void;
  kept: number;
  more: () => void;
  move: RevisitMove | null;
  pending: boolean;
  position: number;
  retry: () => void;
  status: DeckState["status"];
  total: number;
  undo: () => Promise<void>;
}

export function useRevisitDeck({
  onArchive,
  onUnarchive,
  queryArgs,
}: UseRevisitDeckOptions): RevisitDeck {
  const convex = useConvex();
  const key = queryArgs ? JSON.stringify(queryArgs) : null;
  const [state, setState] = useState<DeckState>(LOADING);
  const [dealCount, setDealCount] = useState(0);
  const [pending, setPending] = useState(false);
  const seen = useRef<{ ids: Set<string>; key: string | null }>({
    ids: new Set(),
    key: null,
  });
  const busy = useRef<boolean>(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const archivedStack = useRef<string[]>([]);
  const dealGeneration = useRef(0);
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

  const deal = useMemo(
    () => (key === null ? null : { key, round: dealCount }),
    [dealCount, key]
  );

  useEffect(() => {
    if (deal === null) {
      return;
    }
    dealGeneration.current += 1;
    if (seen.current.key !== deal.key) {
      seen.current = { ids: new Set(), key: deal.key };
    }
    const seenIds = seen.current.ids;
    const args = JSON.parse(deal.key) as CardsSearchQueryArgs;
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
  }, [convex, deal]);

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
    const generation = dealGeneration.current;
    busy.current = true;
    setPending(true);
    const request = onArchive(card._id).catch(() => false);
    inFlight.current = request;
    const archivedOk = await request;
    inFlight.current = null;
    busy.current = false;
    setPending(false);
    if (!archivedOk || generation !== dealGeneration.current) {
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
