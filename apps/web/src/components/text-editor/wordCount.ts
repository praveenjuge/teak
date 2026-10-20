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

const numberFormat = new Intl.NumberFormat();

export const formatWordCount = (count: number) =>
  `${numberFormat.format(count)} ${count === 1 ? "word" : "words"}`;
