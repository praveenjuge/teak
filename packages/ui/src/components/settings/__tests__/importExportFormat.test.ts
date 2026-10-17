import { describe, expect, test } from "bun:test";
import { formatCountdown, formatRelativeTime } from "../importExportFormat";

describe("formatCountdown", () => {
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  test("returns days + hours when more than a day out", () => {
    expect(formatCountdown(2 * day + 3 * hour)).toBe("2d 3h");
  });

  test("returns hours + minutes under a day", () => {
    expect(formatCountdown(5 * hour + 20 * minute)).toBe("5h 20m");
  });

  test("clamps non-positive durations", () => {
    expect(formatCountdown(0)).toBe("now");
    expect(formatCountdown(-1000)).toBe("now");
  });
});

describe("formatRelativeTime", () => {
  const now = 1_000_000_000_000;

  test("describes recent timestamps", () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(formatRelativeTime(now - 60_000, now)).toBe("1 minute ago");
    expect(formatRelativeTime(now - 3 * 60 * 60_000, now)).toBe("3 hours ago");
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe(
      "2 days ago"
    );
  });
});
