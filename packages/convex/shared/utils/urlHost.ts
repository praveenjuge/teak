export const normalizeUrlHost = (
  value: string | null | undefined
): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (/^[a-z][a-z\d+.-]*:(?!\/\/)(?!\d)/i.test(trimmed)) {
    return null;
  }
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  let hostname: string;
  try {
    hostname = new URL(withScheme).hostname;
  } catch {
    return null;
  }
  let host = hostname.toLowerCase();
  while (host.endsWith(".")) {
    host = host.slice(0, -1);
  }
  if (host.startsWith("www.") && host.length > 4) {
    host = host.slice(4);
  }
  return host || null;
};

const PUNYCODE_BASE = 36;
const PUNYCODE_T_MIN = 1;
const PUNYCODE_T_MAX = 26;
const PUNYCODE_SKEW = 38;
const PUNYCODE_DAMP = 700;
const PUNYCODE_INITIAL_BIAS = 72;
const PUNYCODE_INITIAL_N = 128;

const adaptBias = (delta: number, points: number, first: boolean) => {
  let next = Math.floor(first ? delta / PUNYCODE_DAMP : delta / 2);
  next += Math.floor(next / points);
  let k = 0;
  while (
    next > Math.floor(((PUNYCODE_BASE - PUNYCODE_T_MIN) * PUNYCODE_T_MAX) / 2)
  ) {
    next = Math.floor(next / (PUNYCODE_BASE - PUNYCODE_T_MIN));
    k += PUNYCODE_BASE;
  }
  return (
    k +
    Math.floor(
      ((PUNYCODE_BASE - PUNYCODE_T_MIN + 1) * next) / (next + PUNYCODE_SKEW)
    )
  );
};

const digitValue = (code: number): number => {
  if (code >= 48 && code <= 57) {
    return code - 22;
  }
  if (code >= 65 && code <= 90) {
    return code - 65;
  }
  if (code >= 97 && code <= 122) {
    return code - 97;
  }
  return PUNYCODE_BASE;
};

const decodePunycodeLabel = (input: string): string | null => {
  const output: number[] = [];
  const basicEnd = input.lastIndexOf("-");
  for (let index = 0; index < Math.max(basicEnd, 0); index += 1) {
    output.push(input.charCodeAt(index));
  }
  let n = PUNYCODE_INITIAL_N;
  let bias = PUNYCODE_INITIAL_BIAS;
  let i = 0;
  let position = basicEnd > 0 ? basicEnd + 1 : 0;
  while (position < input.length) {
    const oldI = i;
    let weight = 1;
    for (let k = PUNYCODE_BASE; ; k += PUNYCODE_BASE) {
      if (position >= input.length) {
        return null;
      }
      const digit = digitValue(input.charCodeAt(position));
      position += 1;
      if (digit >= PUNYCODE_BASE) {
        return null;
      }
      i += digit * weight;
      let threshold = k - bias;
      if (k <= bias) {
        threshold = PUNYCODE_T_MIN;
      } else if (k >= bias + PUNYCODE_T_MAX) {
        threshold = PUNYCODE_T_MAX;
      }
      if (digit < threshold) {
        break;
      }
      weight *= PUNYCODE_BASE - threshold;
      if (!(Number.isSafeInteger(i) && Number.isSafeInteger(weight))) {
        return null;
      }
    }
    const points = output.length + 1;
    bias = adaptBias(i - oldI, points, oldI === 0);
    n += Math.floor(i / points);
    i %= points;
    if (n > 0x10_ff_ff) {
      return null;
    }
    output.splice(i, 0, n);
    i += 1;
  }
  return String.fromCodePoint(...output);
};

export const cardSiteHost = (card: {
  sourceUrl?: string | null;
  url?: string | null;
}): string | null => normalizeUrlHost(card.url ?? card.sourceUrl);

export const hostForDisplay = (host: string): string =>
  host
    .split(".")
    .map((label) =>
      label.startsWith("xn--")
        ? (decodePunycodeLabel(label.slice(4)) ?? label)
        : label
    )
    .join(".");
