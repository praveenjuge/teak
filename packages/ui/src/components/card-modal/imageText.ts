/** Lines of image text shown before "Show all". */
export const IMAGE_TEXT_FOLD_LINES = 6;
const IMAGE_TEXT_FOLD_LENGTH = 360;
const CODE_LINE =
  /^(?:\t| {2,})|[;{}]\s*$|^\s*(?:\/\/|#include|import |def |function |const |let |return )/;

/** Whether image text runs past the folded block (6 lines or so). */
export const isLongImageText = (text: string) =>
  text.split("\n").length > IMAGE_TEXT_FOLD_LINES ||
  text.length > IMAGE_TEXT_FOLD_LENGTH;

/**
 * Whether image text reads as code (a screenshot of an editor): most of its
 * lines are indented or end in `;`, `{` or `}`. Code keeps a monospace font.
 */
export const looksLikeCode = (text: string) => {
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < 3) {
    return false;
  }
  const codeLines = lines.filter((line) => CODE_LINE.test(line)).length;
  return codeLines / lines.length >= 0.5;
};
