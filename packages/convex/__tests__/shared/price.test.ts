import { describe, expect, test } from "bun:test";
import {
  formatLinkPrice,
  isLinkPrice,
  type LinkPrice,
  MAX_PRICE_AMOUNT,
  parsePrice,
  parseStructuredPrice,
} from "../../shared/price";

describe("parsePrice", () => {
  test.each([
    // [text, currency hint, expected]
    ["$1,299.00", undefined, { amount: 1299, currency: "USD" }],
    ["1.299,00 €", undefined, { amount: 1299, currency: "EUR" }],
    ["1 299,00 zł", undefined, { amount: 1299, currency: "PLN" }],
    ["1 299,00 zł", undefined, { amount: 1299, currency: "PLN" }],
    ["1 299,00 €", undefined, { amount: 1299, currency: "EUR" }],
    ["1'299.50 CHF", undefined, { amount: 1299.5, currency: "CHF" }],
    ["€1.299", undefined, { amount: 1299, currency: "EUR" }],
    ["12,50 €", undefined, { amount: 12.5, currency: "EUR" }],
    ["£19.99", undefined, { amount: 19.99, currency: "GBP" }],
    ["¥1,299,999", undefined, { amount: 1_299_999, currency: "JPY" }],
    ["₹2,499", undefined, { amount: 2499, currency: "INR" }],
    ["USD 20", undefined, { amount: 20, currency: "USD" }],
    ["20 EUR", undefined, { amount: 20, currency: "EUR" }],
    ["R$ 49,90", undefined, { amount: 49.9, currency: "BRL" }],
    ["CA$15", undefined, { amount: 15, currency: "CAD" }],
    ["1.299.999,00 kr", undefined, { amount: 1_299_999 }],
    ["1.299.999,00 kr", "SEK", { amount: 1_299_999, currency: "SEK" }],
    ["0.999", undefined, { amount: 0.999 }],
    ["$.99", undefined, { amount: 0.99, currency: "USD" }],
    ["24.99", undefined, { amount: 24.99 }],
    ["24.99", "eur", { amount: 24.99, currency: "EUR" }],
    // The hint wins over a bare `$`, which may be CAD or AUD.
    ["$24.99", "AUD", { amount: 24.99, currency: "AUD" }],
    // A hint that is not a code is ignored.
    ["$24.99", "dollars", { amount: 24.99, currency: "USD" }],
    ["Free", undefined, { amount: 0 }],
    ["FREE", "USD", { amount: 0, currency: "USD" }],
    ["0", undefined, { amount: 0 }],
    ["$10–$20", undefined, { amount: 10, currency: "USD" }],
    ["$10 - $20", undefined, { amount: 10, currency: "USD" }],
    ["$20 - $10", undefined, { amount: 10, currency: "USD" }],
    ["10 € to 25 €", undefined, { amount: 10, currency: "EUR" }],
    ["1,000,000", undefined, { amount: 1_000_000 }],
    ["10000000", undefined, { amount: MAX_PRICE_AMOUNT }],
    ["  $24.99  $24.99 ", undefined, { amount: 24.99, currency: "USD" }],
  ])(
    "reads %p (hint %p)",
    (text: string, hint: string | undefined, expected: LinkPrice) => {
      expect(parsePrice(text, hint)).toEqual(expected);
    }
  );

  test.each([
    ["Contact us"],
    [""],
    ["USD"],
    ["$-5"],
    ["-$5"],
    ["-5 €"],
    ["10000001"],
    ["$1e9"],
    ["٣٤٥"],
    ["x".repeat(300)],
  ])("refuses %p", (text: string) => {
    expect(parsePrice(text)).toBeNull();
  });

  test.each([
    [24.99, "USD", { amount: 24.99, currency: "USD" }],
    [0, undefined, { amount: 0 }],
    [-1, undefined, null],
    [Number.NaN, undefined, null],
    [Number.POSITIVE_INFINITY, undefined, null],
    [20_000_000, undefined, null],
    [null, undefined, null],
    [{ amount: 1 }, undefined, null],
  ])(
    "reads the structured value %p",
    (value: unknown, hint: string | undefined, expected: LinkPrice | null) => {
      expect(parsePrice(value, hint)).toEqual(expected);
    }
  );

  test("never throws and never returns an unusable amount on noisy text", () => {
    const pieces = [
      "1",
      "9",
      "0",
      ".",
      ",",
      " ",
      " ",
      "'",
      "-",
      "–",
      "$",
      "€",
      "kr",
      "USD",
      "١",
      "۵",
      "٫",
      "e",
      "Free",
      "to",
    ];
    let seed = 7;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    for (let run = 0; run < 2000; run += 1) {
      let text = "";
      const length = next() % 12;
      for (let index = 0; index < length; index += 1) {
        text += pieces[next() % pieces.length];
      }
      const price = parsePrice(text);
      if (price !== null) {
        expect(isLinkPrice(price)).toBe(true);
        expect(price.amount).toBeGreaterThanOrEqual(0);
        expect(price.amount).toBeLessThanOrEqual(MAX_PRICE_AMOUNT);
      }
    }
  });
});

describe("parseStructuredPrice", () => {
  test.each([
    [
      "a Product with one offer",
      {
        "@type": "Product",
        offers: { price: "24.99", priceCurrency: "USD" },
      },
      { amount: 24.99, currency: "USD" },
    ],
    [
      "an offers array, lowest first",
      {
        "@type": "Product",
        offers: [
          { price: 30, priceCurrency: "EUR" },
          { price: "Contact us" },
          { price: 19.5, priceCurrency: "EUR" },
        ],
      },
      { amount: 19.5, currency: "EUR" },
    ],
    [
      "an AggregateOffer's low price",
      {
        offers: {
          "@type": "AggregateOffer",
          lowPrice: 10,
          highPrice: 20,
          priceCurrency: "USD",
        },
      },
      { amount: 10, currency: "USD" },
    ],
    [
      "an AggregateOffer's nested offers",
      {
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "USD",
          offers: [{ price: 12 }, { price: 9 }],
        },
      },
      { amount: 9 },
    ],
    [
      "an Offer on its own",
      { "@type": "Offer", price: "5", priceCurrency: "GBP" },
      { amount: 5, currency: "GBP" },
    ],
    [
      "a ProductGroup's cheapest variant",
      {
        "@type": "ProductGroup",
        hasVariant: [
          {
            "@type": "Product",
            offers: { price: "44.99", priceCurrency: "EUR" },
          },
          {
            "@type": "Product",
            offers: { price: "39.99", priceCurrency: "EUR" },
          },
          { "@type": "Product", name: "No offer" },
        ],
      },
      { amount: 39.99, currency: "EUR" },
    ],
    ["a Product without offers", { "@type": "Product", name: "x" }, null],
    ["a free offer", { offers: { price: "0" } }, { amount: 0 }],
    ["text", "24.99", null],
  ])("reads %s", (_name: string, entity: unknown, expected: unknown) => {
    expect<unknown>(parseStructuredPrice(entity)).toEqual(expected);
  });
});

describe("formatLinkPrice", () => {
  test.each([
    [{ amount: 24.99, currency: "USD" }, "$24.99"],
    [{ amount: 1299, currency: "EUR" }, "€1,299.00"],
    [{ amount: 1_299_999, currency: "JPY" }, "¥1,299,999"],
    [{ amount: 0, currency: "USD" }, "Free"],
    [{ amount: 12.5 }, "12.5"],
    [{ amount: 12, currency: "ZZZZ" }, "12"],
  ])("writes %p as %p", (price: LinkPrice, label: string) => {
    expect(formatLinkPrice(price, "en-US")).toBe(label);
  });
});
