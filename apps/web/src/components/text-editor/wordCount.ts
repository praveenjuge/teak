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
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) {
      count += 1;
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
