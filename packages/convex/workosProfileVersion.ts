interface ProfileVersion {
  canonical: string;
  key: bigint;
}

function parseVersion(raw: string): ProfileVersion {
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,18}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      raw
    );
  if (!parts || raw.length > 64) {
    throw new Error("Invalid WorkOS profile version");
  }
  const [, year, month, day, hour, minute, second, fraction = "", offset] =
    parts;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
  const validCalendar =
    calendar.getUTCFullYear() === Number(year) &&
    calendar.getUTCMonth() + 1 === Number(month) &&
    calendar.getUTCDate() === Number(day);
  const validClock =
    Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60;
  const validOffset =
    offset === "Z" ||
    (Number(offset.slice(1, 3)) < 24 && Number(offset.slice(4)) < 60);
  const milliseconds = Date.parse(
    `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`
  );
  if (
    !(
      validCalendar &&
      validClock &&
      validOffset &&
      Number.isFinite(milliseconds)
    ) ||
    milliseconds < 0 ||
    milliseconds + Number(`0.${fraction || "0"}`) * 1000 > Date.now() + 300_000
  ) {
    throw new Error("Invalid WorkOS profile version");
  }
  const trimmedFraction = fraction.replace(/0+$/, "");
  return {
    canonical: `${new Date(milliseconds).toISOString().slice(0, 19)}${trimmedFraction ? `.${trimmedFraction}` : ""}Z`,
    key:
      BigInt(milliseconds / 1000) * BigInt("1000000000000000000") +
      BigInt(fraction.padEnd(18, "0")),
  };
}

export const normalizeWorkosProfileVersion = (raw: string): string =>
  parseVersion(raw).canonical;

export function compareWorkosProfileVersions(
  left: string,
  right: string
): -1 | 0 | 1 {
  const first = parseVersion(left).key;
  const second = parseVersion(right).key;
  if (first < second) {
    return -1;
  }
  if (first > second) {
    return 1;
  }
  return 0;
}
