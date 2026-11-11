import type { Doc } from "../_generated/dataModel";
import { DAY_MS, utcDay } from "./dates";

const RESERVED_EMAIL_DOMAIN =
  /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/;

export const isAutoInternalAccount = (
  user: Pick<Doc<"users">, "email" | "role">
): boolean => {
  if (user.role === "admin") {
    return true;
  }
  const email = user.email.toLowerCase();
  const domain = email.split("@").pop() ?? "";
  return email.includes("e2e-") || RESERVED_EMAIL_DOMAIN.test(domain);
};

export interface MetricsUserRow {
  createdAt: number;
  deleted: boolean;
  email: string;
  isAdmin: boolean;
  teakUserId: string;
}

export interface MetricsCardRow {
  createdAt: number;
  deleted: boolean;
  fileSize: number;
  userId: string;
}

export const autoInternalUserIds = (users: MetricsUserRow[]): string[] =>
  users
    .filter((user) =>
      isAutoInternalAccount({
        email: user.email,
        role: user.isAdmin ? "admin" : undefined,
      })
    )
    .map((user) => user.teakUserId);

const SNAPSHOT_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const snapshotDay = (date: string | undefined, now: number) => {
  const day = date ?? utcDay(now - DAY_MS);
  if (!SNAPSHOT_DATE.test(day)) {
    throw new Error("Snapshot date must be YYYY-MM-DD");
  }
  const dayStart = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(dayStart) || dayStart > now) {
    throw new Error("Snapshot date must not be in the future");
  }
  return { day, dayStart, dayEnd: dayStart + DAY_MS };
};

/** Polar only reports the present, so only yesterday or today gets billing. */
export const snapshotTakesBilling = (dayEnd: number, now: number) =>
  now - dayEnd < DAY_MS;

export interface SnapshotCounts {
  accounts: number;
  activeSavers1d: number;
  activeSavers7d: number;
  activeSavers28d: number;
  aiCalls: number;
  aiCostUsd: number;
  cardsSaved: number;
  signups: number;
  storageBytesAdded: number;
}

/** The days, newest first, whose savers count toward 28-day active savers. */
export const ACTIVE_SAVER_DAYS = 28;

/**
 * Savers stored for one day. Convex refuses an array argument over 8192
 * values before the handler runs, so the Core Worker trims a day to this
 * before sending it and marks the day truncated.
 */
export const MAX_DAY_SAVERS = 8000;

/** `day` and the `count - 1` UTC days before it, newest first. */
export const precedingDays = (day: string, count: number): string[] => {
  const start = Date.parse(`${day}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, i) => utcDay(start - i * DAY_MS));
};

/**
 * Counts one day's snapshot from users, that day's cards, the savers of the
 * days before it and AI usage, leaving internal accounts out. Only the day's
 * own cards are read, so the snapshot never scans every card.
 */
export const createSnapshotTally = ({
  dayEnd,
  dayStart,
  internalIds,
}: {
  dayEnd: number;
  dayStart: number;
  internalIds: ReadonlySet<string>;
}) => {
  let accounts = 0;
  let signups = 0;
  let cardsSaved = 0;
  let storageBytesAdded = 0;
  let aiCostUsd = 0;
  let aiCalls = 0;
  const savers1d = new Set<string>();
  const savers7d = new Set<string>();
  const savers28d = new Set<string>();
  const addSaver = (userId: string, dayStartMs: number) => {
    if (dayStartMs >= dayEnd - 7 * DAY_MS) {
      savers7d.add(userId);
    }
    if (dayStartMs >= dayEnd - ACTIVE_SAVER_DAYS * DAY_MS) {
      savers28d.add(userId);
    }
  };
  return {
    addUser(user: MetricsUserRow) {
      if (internalIds.has(user.teakUserId)) {
        return;
      }
      if (!user.deleted && user.createdAt < dayEnd) {
        accounts += 1;
      }
      if (user.createdAt >= dayStart && user.createdAt < dayEnd) {
        signups += 1;
      }
    },
    /** A card saved on the snapshot's day; any other card is ignored. */
    addCard(card: MetricsCardRow) {
      if (
        internalIds.has(card.userId) ||
        card.createdAt < dayStart ||
        card.createdAt >= dayEnd
      ) {
        return;
      }
      cardsSaved += 1;
      storageBytesAdded += card.fileSize;
      savers1d.add(card.userId);
      addSaver(card.userId, dayStart);
    },
    /** Who saved a card on an earlier day (`adminDailySavers`). */
    addSaverDay(day: string, userIds: readonly string[]) {
      const dayStartMs = Date.parse(`${day}T00:00:00.000Z`);
      if (dayStartMs >= dayStart) {
        return;
      }
      for (const userId of userIds) {
        if (!internalIds.has(userId)) {
          addSaver(userId, dayStartMs);
        }
      }
    },
    addUsage(row: { calls: number; costUsd: number; userId: string }) {
      if (!internalIds.has(row.userId)) {
        aiCostUsd += row.costUsd;
        aiCalls += row.calls;
      }
    },
    counts(): SnapshotCounts {
      return {
        accounts,
        signups,
        cardsSaved,
        activeSavers1d: savers1d.size,
        activeSavers7d: savers7d.size,
        activeSavers28d: savers28d.size,
        storageBytesAdded,
        aiCostUsd,
        aiCalls,
      };
    },
  };
};
