export const DAY_MS = 24 * 60 * 60 * 1000;

export const utcDay = (timestamp: number) =>
  new Date(timestamp).toISOString().slice(0, 10);

export const startOfUtcDay = (timestamp: number) =>
  Date.parse(`${utcDay(timestamp)}T00:00:00.000Z`);

export const startOfUtcWeek = (timestamp: number) => {
  const day = startOfUtcDay(timestamp);
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  return day - weekday * DAY_MS;
};

export const daysAgoDate = (days: number, now = Date.now()) =>
  utcDay(now - days * DAY_MS);
