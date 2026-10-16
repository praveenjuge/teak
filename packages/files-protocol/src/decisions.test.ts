import { expect, test } from "bun:test";
import {
  readCardTypeDecision,
  readLinkCategoryDecision,
  readRelevanceResult,
  readVisualStylesDecision,
} from "./decisions";

const facts = { model: "@cf/cloudflare/clef", version: 1 };
const isCategory = (value: string) => ["recipe", "other"].includes(value);
const isStyle = (value: string) => ["minimal", "flat"].includes(value);

test.each([
  [
    "a decision",
    { ...facts, decision: { category: "recipe", confidence: 0.9 } },
    true,
  ],
  ["no decision", { ...facts, decision: null }, true],
  [
    "an unknown category",
    { ...facts, decision: { category: "cookbook", confidence: 0.9 } },
    false,
  ],
  [
    "a confidence over 1",
    { ...facts, decision: { category: "recipe", confidence: 1.2 } },
    false,
  ],
  ["no model", { version: 1, decision: null }, false],
  [
    "bad usage",
    { ...facts, usage: { inputTokens: -1, outputTokens: 0 }, decision: null },
    false,
  ],
])("link category reply with %s", (_name, value, valid) => {
  expect(readLinkCategoryDecision(value, isCategory) !== null).toBe(valid);
});

test.each([
  [
    "a decision",
    { ...facts, decision: { type: "quote", confidence: 0.9 } },
    true,
  ],
  [
    "an unknown type",
    { ...facts, decision: { type: "image", confidence: 0.9 } },
    false,
  ],
])("card type reply with %s", (_name, value, valid) => {
  expect(readCardTypeDecision(value) !== null).toBe(valid);
});

test.each([
  ["styles", { ...facts, styles: ["minimal", "flat"] }, true],
  ["no styles", { ...facts, styles: [] }, true],
  ["an unknown style", { ...facts, styles: ["grunge"] }, false],
  ["a repeated style", { ...facts, styles: ["flat", "flat"] }, false],
  ["five styles", { ...facts, styles: ["a", "b", "c", "d", "e"] }, false],
])("visual styles reply with %s", (_name, value, valid) => {
  expect(
    readVisualStylesDecision(value, (s) => isStyle(s) || s.length === 1) !==
      null
  ).toBe(valid);
});

test.each([
  [
    "every card scored",
    [
      { id: "a", score: 3 },
      { id: "b", score: 0 },
    ],
    true,
  ],
  ["a card missing", [{ id: "a", score: 3 }], false],
  [
    "an unknown card",
    [
      { id: "a", score: 3 },
      { id: "c", score: 1 },
    ],
    false,
  ],
  [
    "a score past the rubric",
    [
      { id: "a", score: 4 },
      { id: "b", score: 0 },
    ],
    false,
  ],
])("relevance reply with %s", (_name, scores, valid) => {
  expect(readRelevanceResult({ ...facts, scores }, ["a", "b"]) !== null).toBe(
    valid
  );
});
