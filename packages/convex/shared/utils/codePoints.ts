export const codePointLength = (text: string): number =>
  Array.from(text).length;

export const truncateCodePoints = (text: string, max: number): string =>
  Array.from(text).slice(0, max).join("");
