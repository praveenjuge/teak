import { expect, test } from "bun:test";
import {
  choiceRows,
  median,
  ndcgAt,
  percentile,
  styleBreakdown,
  styleRows,
} from "./metrics";

test("a change counts only when Clef disagrees, is sure, and may", () => {
  const rows = choiceRows(
    [
      { rules: "other", label: "recipe", choice: "recipe", probability: 0.9 },
      { rules: "other", label: "article", choice: "news", probability: 0.92 },
      { rules: "book", label: "book", choice: "book", probability: 0.99 },
      { rules: "other", label: "course", choice: "course", probability: 0.6 },
      { rules: "article", label: "other", choice: "other", probability: 0.99 },
    ],
    ["other"]
  );
  const at85 = rows.find((row) => row.threshold === 0.85);
  expect(at85).toEqual({
    threshold: 0.85,
    changed: 2,
    precision: 0.5,
    coverage: 0.25,
    accuracy: 0.4,
  });
  const at55 = rows.find((row) => row.threshold === 0.55);
  expect(at55?.changed).toBe(3);
  expect(at55?.coverage).toBe(0.5);
});

test("styles score the top four over the threshold", () => {
  const rows = styleRows([
    {
      labels: ["minimal", "flat"],
      probabilities: { minimal: 0.9, flat: 0.8, dark: 0.75, retro: 0.2 },
    },
  ]);
  const at7 = rows.find((row) => row.threshold === 0.7);
  expect(at7?.precision).toBeCloseTo(2 / 3);
  expect(at7?.recall).toBe(1);
  expect(at7?.f1).toBeCloseTo(0.8);
});

test("each style is scored on its own", () => {
  const rows = styleBreakdown(
    [
      {
        labels: ["minimal"],
        probabilities: { minimal: 0.9, dark: 0.8, retro: 0.1 },
      },
      {
        labels: ["minimal", "retro"],
        probabilities: { minimal: 0.95, dark: 0.1, retro: 0.3 },
      },
    ],
    0.7
  );
  expect(rows).toEqual([
    { style: "dark", labelled: 0, predicted: 1, precision: 0, recall: 1 },
    { style: "minimal", labelled: 2, predicted: 2, precision: 1, recall: 1 },
    { style: "retro", labelled: 1, predicted: 0, precision: 1, recall: 0 },
  ]);
});

test("nDCG is 1 for the ideal order and lower otherwise", () => {
  const relevance = { a: 3, b: 1, c: 0 };
  expect(ndcgAt(["a", "b", "c"], relevance)).toBe(1);
  expect(ndcgAt(["c", "b", "a"], relevance)).toBeLessThan(1);
});

test("median and p95", () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 2, 3])).toBe(2.5);
  expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
});
