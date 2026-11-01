import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";
import { markdownToPlainText } from "../../lib/markdownToPlainText";

const segmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

/**
 * Marks that join words into one token, as in "long-term", "snake_case",
 * "example.com" or "and/or". Spaces and other punctuation still split.
 */
const JOINER = /^[-\u2010\u2011_./@+'\u2019]+$/u;

export function countWords(markdown: string): number {
  const text = markdownToPlainText(markdown, {
    maxLength: Number.POSITIVE_INFINITY,
  });
  if (!text.trim()) {
    return 0;
  }
  if (!segmenter) {
    return text.split(/\s+/).filter(Boolean).length;
  }
  let count = 0;
  // Whether the last segment was a word, or a joiner right after one.
  let joinable = false;
  let afterJoiner = false;
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) {
      if (!(joinable && afterJoiner)) {
        count += 1;
      }
      joinable = true;
      afterJoiner = false;
    } else if (joinable && !afterJoiner && JOINER.test(segment.segment)) {
      afterJoiner = true;
    } else {
      joinable = false;
      afterJoiner = false;
    }
  }
  return count;
}

const englishTextEditor = createTeakTranslator(
  "en",
  englishMessages,
  "textEditor"
);

export const formatWordCount = (
  count: number,
  t: TeakTranslator<"textEditor"> = englishTextEditor
) => t("focus.wordCount", { count });
