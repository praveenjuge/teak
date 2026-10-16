/**
 * A product's price as Teak stores it on a link card
 * (`metadata.linkCategory.price`). `currency` is an ISO 4217 code when the
 * page said which; `price:` searches compare `amount` only.
 */
export interface LinkPrice {
  amount: number;
  currency?: string;
}

/** The highest amount Teak reads as a price; anything above is noise. */
export const MAX_PRICE_AMOUNT = 10_000_000;

// Longest text worth reading; a price is a few words at most.
const MAX_PRICE_TEXT_LENGTH = 200;

// Symbols that name one currency. Longer ones first, so `R$` wins over `$`.
// `kr` is left out: it is SEK, NOK, DKK or ISK.
const CURRENCY_SYMBOLS: readonly [string, string][] = [
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
];

// Codes read from the text itself ("USD 20", "20 EUR"); any three capitals
// would also match words like "NEW".
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
// Digits with the marks that group or split them: `1,299.00`, `1.299,00`,
// `1 299,00` (with ordinary, no-break or thin spaces) and `1'299.00`.
const NUMBER_PATTERN = /\d+(?:[.,'’    ]\d+)*/;
const SPACE_GROUP_PATTERN = /^[ '’   ]$/;
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

/**
 * Reads one number written with any grouping and decimal marks. With both
 * `.` and `,` the last one is the decimal mark. With one of them, it groups
 * when it appears more than once or when exactly three digits follow it
 * (`1,299`, `1.299`), and is the decimal mark otherwise (`12,50`, `19.99`).
 */
const readNumber = (token: string): number | null => {
  const parts = token.split(/(\D)/);
  const digits: string[] = [parts[0] ?? ""];
  const marks: string[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const mark = parts[index] ?? "";
    const group = parts[index + 1] ?? "";
    // A space only groups thousands: `20 25` is two numbers.
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

/**
 * A price from the text a page shows ("$1,299.00", "1.299,00 €",
 * "1 299,00 zł", "USD 20", "Free") or a structured value (`24.99`). The
 * hint (`og:price:currency`, `priceCurrency`) names the currency when it is
 * a three-letter code; otherwise a code or symbol in the text does, and a
 * bare `$` is USD. "Free" is 0, and a range ("$10–$20") is its low end.
 * Null for text without a number ("Contact us"), a negative amount, or an
 * amount over 10,000,000.
 */
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
  // A negative amount or an exponent ("1e9") is not a price.
  if (NEGATIVE_PREFIX_PATTERN.test(before) || /^[eE][+-]?\d/.test(after)) {
    return null;
  }
  // A bare fraction: "$.99".
  let amount =
    /[.,]$/.test(before) && /^\d+$/.test(match[0])
      ? Number(`0.${match[0]}`)
      : readNumber(match[0]);
  if (!validAmount(amount)) {
    return null;
  }

  // A range keeps its low end, whichever side it is written on.
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

/**
 * A JSON-LD `Product`'s price, or an `Offer`'s own: the lowest of its
 * offers (an `offers` array), an `AggregateOffer`'s `lowPrice`, an offer's
 * `price` or its `priceSpecification`. A `ProductGroup` (how Shopify stores
 * describe a product with sizes or colours) costs its cheapest variant.
 */
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

/** Whether a stored value is a usable price. */
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

/**
 * A price written for people: "$24.99", "€1,299.00", "¥1,299,999", or
 * "Free" for 0. A missing or unknown currency shows the bare amount.
 */
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
      // An unknown code falls back to the amount.
    }
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    price.amount
  );
};
