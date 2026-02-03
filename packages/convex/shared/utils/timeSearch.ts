export type CreatedAtRange = { start: number; end: number };

export type TimeFilter = {
  label: string;
  range: CreatedAtRange;
  kind: "relative" | "weekday" | "date" | "month" | "year" | "range";
};

type DateRange = {
  start: Date;
  end: Date;
  label: string;
  kind: TimeFilter["kind"];
};

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const normalizeQuery = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();

const titleCase = (value: string) =>
  value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const toRange = (start: Date, end: Date): CreatedAtRange => ({
  start: start.getTime(),
  end: end.getTime(),
});

const formatDayLabel = (date: Date) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);

const formatMonthLabel = (date: Date) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(date);

const isValidDate = (year: number, monthIndex: number, day: number) => {
  const candidate = new Date(year, monthIndex, day);
  return (
    candidate.getFullYear() === year &&
    candidate.getMonth() === monthIndex &&
    candidate.getDate() === day
  );
};

const parseRelative = (
  query: string,
  now: Date,
  weekStart: 0 | 1
): DateRange | null => {
  const normalized = query;
  const today = startOfDay(now);
  if (normalized === "today") {
    return {
      start: today,
      end: addDays(today, 1),
      label: "Today",
      kind: "relative",
    };
  }

  if (normalized === "yesterday") {
    const start = addDays(today, -1);
    return {
      start,
      end: today,
      label: "Yesterday",
      kind: "relative",
    };
  }

  if (normalized === "this week" || normalized === "last week") {
    const day = today.getDay();
    const diff = (day - weekStart + 7) % 7;
    const startOfWeek = addDays(today, -diff);
    if (normalized === "this week") {
      return {
        start: startOfWeek,
        end: addDays(startOfWeek, 7),
        label: "This Week",
        kind: "relative",
      };
    }

    const start = addDays(startOfWeek, -7);
    return {
      start,
      end: startOfWeek,
      label: "Last Week",
      kind: "relative",
    };
  }

  if (normalized === "this month" || normalized === "last month") {
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    if (normalized === "this month") {
      return {
        start: startOfMonth,
        end: new Date(today.getFullYear(), today.getMonth() + 1, 1),
        label: "This Month",
        kind: "relative",
      };
    }

    const lastMonthStart = new Date(
      today.getFullYear(),
      today.getMonth() - 1,
      1
    );
    return {
      start: lastMonthStart,
      end: startOfMonth,
      label: "Last Month",
      kind: "relative",
    };
  }

  if (normalized === "this year" || normalized === "last year") {
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    if (normalized === "this year") {
      return {
        start: startOfYear,
        end: new Date(today.getFullYear() + 1, 0, 1),
        label: "This Year",
        kind: "relative",
      };
    }

    const lastYearStart = new Date(today.getFullYear() - 1, 0, 1);
    return {
      start: lastYearStart,
      end: startOfYear,
      label: "Last Year",
      kind: "relative",
    };
  }

  return null;
};

const parseWeekday = (query: string, now: Date): DateRange | null => {
  const normalized = query;
  const lastPrefix = normalized.startsWith("last ");
  const weekdayToken = lastPrefix
    ? normalized.replace(/^last\s+/, "")
    : normalized;
  const weekdayIndex = WEEKDAYS[weekdayToken];
  if (weekdayIndex === undefined) {
    return null;
  }

  const today = startOfDay(now);
  const diff = (today.getDay() - weekdayIndex + 7) % 7;
  const mostRecent = addDays(today, -diff);
  const start = lastPrefix ? addDays(mostRecent, -7) : mostRecent;
  const label = lastPrefix
    ? `Last ${titleCase(weekdayToken)}`
    : titleCase(weekdayToken);
  return {
    start,
    end: addDays(start, 1),
    label,
    kind: "weekday",
  };
};

const parseExplicitDate = (query: string): DateRange | null => {
  const normalized = query;

  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    if (isValidDate(year, month, day)) {
      const start = new Date(year, month, day);
      return {
        start,
        end: addDays(start, 1),
        label: formatDayLabel(start),
        kind: "date",
      };
    }
  }

  const usMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const month = Number(usMatch[1]) - 1;
    const day = Number(usMatch[2]);
    const year = Number(usMatch[3]);
    if (isValidDate(year, month, day)) {
      const start = new Date(year, month, day);
      return {
        start,
        end: addDays(start, 1),
        label: formatDayLabel(start),
        kind: "date",
      };
    }
  }

  const monthDayYearMatch = normalized.match(
    /^([a-z]+)\s+(\d{1,2})(?:,)?\s+(\d{4})$/
  );
  if (monthDayYearMatch) {
    const monthToken = monthDayYearMatch[1];
    const monthIndex = MONTHS[monthToken];
    if (monthIndex !== undefined) {
      const day = Number(monthDayYearMatch[2]);
      const year = Number(monthDayYearMatch[3]);
      if (isValidDate(year, monthIndex, day)) {
        const start = new Date(year, monthIndex, day);
        return {
          start,
          end: addDays(start, 1),
          label: formatDayLabel(start),
          kind: "date",
        };
      }
    }
  }

  const monthYearMatch = normalized.match(/^([a-z]+)\s+(\d{4})$/);
  if (monthYearMatch) {
    const monthToken = monthYearMatch[1];
    const monthIndex = MONTHS[monthToken];
    if (monthIndex !== undefined) {
      const year = Number(monthYearMatch[2]);
      const start = new Date(year, monthIndex, 1);
      return {
        start,
        end: new Date(year, monthIndex + 1, 1),
        label: formatMonthLabel(start),
        kind: "month",
      };
    }
  }

  const yearMatch = normalized.match(/^(\d{4})$/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    const start = new Date(year, 0, 1);
    return {
      start,
      end: new Date(year + 1, 0, 1),
      label: String(year),
      kind: "year",
    };
  }

  return null;
};

const parseSingleExpression = (
  query: string,
  now: Date,
  weekStart: 0 | 1
): DateRange | null => {
  return (
    parseRelative(query, now, weekStart) ||
    parseWeekday(query, now) ||
    parseExplicitDate(query)
  );
};

export function parseTimeSearchQuery(
  query: string,
  options: { now?: Date; weekStart?: 0 | 1 } = {}
): TimeFilter | null {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return null;
  }

  const now = options.now ?? new Date();
  const weekStart = options.weekStart ?? 0;

  const fromMatch = normalized.match(/^from (.+) to (.+)$/);
  if (fromMatch) {
    const left = parseSingleExpression(fromMatch[1], now, weekStart);
    const right = parseSingleExpression(fromMatch[2], now, weekStart);
    if (left && right && left.start < right.end) {
      return {
        kind: "range",
        label: `${left.label} – ${right.label}`,
        range: toRange(left.start, right.end),
      };
    }
    return null;
  }

  const toMatch = normalized.match(/^(.+) to (.+)$/);
  if (toMatch) {
    const left = parseSingleExpression(toMatch[1], now, weekStart);
    const right = parseSingleExpression(toMatch[2], now, weekStart);
    if (left && right && left.start < right.end) {
      return {
        kind: "range",
        label: `${left.label} – ${right.label}`,
        range: toRange(left.start, right.end),
      };
    }
    return null;
  }

  const dashMatch = normalized.match(/^(.+)\s-\s(.+)$/);
  if (dashMatch) {
    const left = parseSingleExpression(dashMatch[1], now, weekStart);
    const right = parseSingleExpression(dashMatch[2], now, weekStart);
    if (left && right && left.start < right.end) {
      return {
        kind: "range",
        label: `${left.label} – ${right.label}`,
        range: toRange(left.start, right.end),
      };
    }
    return null;
  }

  const single = parseSingleExpression(normalized, now, weekStart);
  if (!single) {
    return null;
  }

  return {
    kind: single.kind,
    label: single.label,
    range: toRange(single.start, single.end),
  };
}
