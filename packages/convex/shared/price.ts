export interface LinkPrice {
  amount: number;
  currency?: string;
}

export const MAX_PRICE_AMOUNT = 10_000_000;

const MAX_PRICE_TEXT_LENGTH = 200;

const CURRENCY_SYMBOLS: readonly [string, string][] = (
  [
    ["US$", "USD"],
    ["CA$", "CAD"],
    ["AU$", "AUD"],
    ["NZ$", "NZD"],
    ["HK$", "HKD"],
    ["MX$", "MXN"],
    ["R$", "BRL"],
    ["C$", "CAD"],
    ["A$", "AUD"],
    ["S$", "SGD"],
    ["zł", "PLN"],
    ["€", "EUR"],
    ["£", "GBP"],
    ["¥", "JPY"],
    ["￥", "JPY"],
    ["₹", "INR"],
    ["₩", "KRW"],
    ["₽", "RUB"],
    ["₺", "TRY"],
    ["₪", "ILS"],
    ["₫", "VND"],
    ["₱", "PHP"],
    ["₴", "UAH"],
    ["₦", "NGN"],
    ["฿", "THB"],
    ["$", "USD"],
  ] as [string, string][]
).sort(([left], [right]) => right.length - left.length);

const KNOWN_CURRENCY_CODES = new Set([
  "AED",
  "ARS",
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CZK",
  "DKK",
  "EGP",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "ISK",
  "JPY",
  "KRW",
  "MXN",
  "MYR",
  "NGN",
  "NOK",
  "NZD",
  "PHP",
  "PKR",
  "PLN",
  "RON",
  "RUB",
  "SAR",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "TWD",
  "UAH",
  "USD",
  "VND",
  "ZAR",
]);

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const CODE_IN_TEXT_PATTERN = /(?:^|[^A-Za-z])([A-Z]{3})(?=$|[^A-Za-z])/g;
const FREE_PATTERN = /\b(?:free|gratis)\b/i;
const NUMBER_PATTERN = /\d+(?:[.,'’ \u00A0\u2009\u202F]\d+)*/;
const SPACE_GROUP_PATTERN = /^[ '’\u00A0\u2009\u202F]$/;
const NEGATIVE_PREFIX_PATTERN = /[-−]\s*\S{0,3}\s*$/;
const RANGE_SEPARATOR_PATTERN =
  /^\s*(?:[A-Z]{3}|[^\w\s]{1,3})?\s*(?:[-–—~]|to)\s*/i;

const normalizeCurrencyCode = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return;
  }
  const code = value.trim().toUpperCase();
  return CURRENCY_CODE_PATTERN.test(code) ? code : undefined;
};

const currencyInText = (text: string): string | undefined => {
  for (const match of text.matchAll(CODE_IN_TEXT_PATTERN)) {
    const code = match[1] ?? "";
    if (KNOWN_CURRENCY_CODES.has(code)) {
      return code;
    }
  }
  for (const [symbol, code] of CURRENCY_SYMBOLS) {
    if (text.includes(symbol)) {
      return code;
    }
  }
};

const readNumber = (token: string): number | null => {
  const parts = token.split(/(\D)/);
  const digits: string[] = [parts[0] ?? ""];
  const marks: string[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const mark = parts[index] ?? "";
    const group = parts[index + 1] ?? "";
    if (SPACE_GROUP_PATTERN.test(mark) && group.length !== 3) {
      break;
    }
    marks.push(mark);
    digits.push(group);
  }

  const lastDot = marks.lastIndexOf(".");
  const lastComma = marks.lastIndexOf(",");
  let decimalAt = -1;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalAt = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const mark = lastDot >= 0 ? "." : ",";
    const at = Math.max(lastDot, lastComma);
    const count = marks.filter((candidate) => candidate === mark).length;
    const following = digits[at + 1] ?? "";
    const groups = count > 1 || (following.length === 3 && digits[0] !== "0");
    decimalAt = groups ? -1 : at;
  }

  let normalized = digits[0] ?? "";
  for (let index = 0; index < marks.length; index += 1) {
    normalized += index === decimalAt ? "." : "";
    normalized += digits[index + 1] ?? "";
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
};

const validAmount = (amount: number | null): amount is number =>
  amount !== null &&
  Number.isFinite(amount) &&
  amount >= 0 &&
  amount <= MAX_PRICE_AMOUNT;

const withCurrency = (amount: number, currency?: string): LinkPrice =>
  currency ? { amount, currency } : { amount };

export const parsePrice = (
  value: unknown,
  currencyHint?: unknown
): LinkPrice | null => {
  const hint = normalizeCurrencyCode(currencyHint);
  if (typeof value === "number") {
    return validAmount(value) ? withCurrency(value, hint) : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_PRICE_TEXT_LENGTH) {
    return null;
  }
  const currency = hint ?? currencyInText(text);

  const match = NUMBER_PATTERN.exec(text);
  if (!match) {
    return FREE_PATTERN.test(text) ? withCurrency(0, currency) : null;
  }
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  if (NEGATIVE_PREFIX_PATTERN.test(before) || /^[eE][+-]?\d/.test(after)) {
    return null;
  }
  let amount =
    /(?:^|[^\p{L}])[.,]$/u.test(before) && /^\d+$/.test(match[0])
      ? Number(`0.${match[0]}`)
      : readNumber(match[0]);
  if (!validAmount(amount)) {
    return null;
  }

  const separator = RANGE_SEPARATOR_PATTERN.exec(after);
  if (separator) {
    const rest = after.slice(separator[0].length);
    const second = NUMBER_PATTERN.exec(rest);
    if (second && second.index <= 4) {
      const high = readNumber(second[0]);
      if (validAmount(high)) {
        amount = Math.min(amount, high);
      }
    }
  }
  return withCurrency(amount, currency);
};

const lowestPrice = (prices: (LinkPrice | null)[]): LinkPrice | null => {
  let lowest: LinkPrice | null = null;
  for (const price of prices) {
    if (price && (!lowest || price.amount < lowest.amount)) {
      lowest = price;
    }
  }
  return lowest;
};

const MAX_OFFER_DEPTH = 3;
const MAX_OFFERS = 50;

const offerPrice = (offer: unknown, depth: number): LinkPrice | null => {
  if (!offer || typeof offer !== "object" || depth > MAX_OFFER_DEPTH) {
    return null;
  }
  if (Array.isArray(offer)) {
    return lowestPrice(
      offer.slice(0, MAX_OFFERS).map((entry) => offerPrice(entry, depth + 1))
    );
  }
  const {
    lowPrice,
    price,
    priceCurrency,
    priceSpecification,
    offers: nested,
  } = offer as Record<string, unknown>;
  const direct =
    parsePrice(lowPrice, priceCurrency) ?? parsePrice(price, priceCurrency);
  if (direct) {
    return direct;
  }
  const specifications = Array.isArray(priceSpecification)
    ? priceSpecification.slice(0, MAX_OFFERS)
    : [priceSpecification];
  return lowestPrice([
    ...specifications.map((specification) => {
      if (!specification || typeof specification !== "object") {
        return null;
      }
      const fields = specification as Record<string, unknown>;
      return parsePrice(fields.price, fields.priceCurrency ?? priceCurrency);
    }),
    offerPrice(nested, depth + 1),
  ]);
};

// Shopify stores describe a product with sizes or colours as a schema.org
// `ProductGroup`, whose `hasVariant` products carry the offers.
export const parseStructuredPrice = (entity: unknown): LinkPrice | null => {
  if (!entity || typeof entity !== "object") {
    return null;
  }
  const { offers, hasVariant } = entity as Record<string, unknown>;
  if (offers !== undefined) {
    return offerPrice(offers, 0);
  }
  if (Array.isArray(hasVariant)) {
    return lowestPrice(
      hasVariant
        .slice(0, MAX_OFFERS)
        .map((variant) =>
          variant && typeof variant === "object"
            ? offerPrice((variant as Record<string, unknown>).offers, 1)
            : null
        )
    );
  }
  return offerPrice(entity, 0);
};

export const isLinkPrice = (value: unknown): value is LinkPrice => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { amount, currency } = value as Record<string, unknown>;
  return (
    typeof amount === "number" &&
    validAmount(amount) &&
    (currency === undefined || typeof currency === "string")
  );
};

const formatPlainAmount = (amount: number, locale?: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount);

export const formatLinkPrice = (price: LinkPrice, locale?: string): string => {
  if (price.amount === 0) {
    return "Free";
  }
  if (price.currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: price.currency,
      }).format(price.amount);
    } catch {
      return formatPlainAmount(price.amount, locale);
    }
  }
  return formatPlainAmount(price.amount, locale);
};
