import { markdownToPlainText } from "../../lib/markdownToPlainText";

// `Intl.Segmenter` (ES2022) is typed here because this package targets ES2020.
interface WordSegmenter {
  segment: (text: string) => Iterable<{ isWordLike?: boolean }>;
}
const Segmenter = (
  Intl as unknown as {
    Segmenter?: new (
      locales: undefined,
      options: { granularity: "word" }
    ) => WordSegmenter;
  }
).Segmenter;
const segmenter = Segmenter
  ? new Segmenter(undefined, { granularity: "word" })
  : null;

/**
 * Words in a note as a reader would count them: Markdown syntax left out,
 * and CJK text (written without spaces) split by the browser's word
 * segmenter rather than by whitespace.
 */
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

/** "1 word", "50,000 words". */
export const formatWordCount = (count: number) =>
  `${numberFormat.format(count)} ${count === 1 ? "word" : "words"}`;
