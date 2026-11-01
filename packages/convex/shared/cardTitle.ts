export const MAX_CARD_TITLE_LENGTH = 512;

export type ParsedCardTitle =
  | { kind: "title"; title: string }
  | { kind: "clear" }
  | { kind: "invalid" };

export const parseCardTitle = (value: unknown): ParsedCardTitle => {
  if (value === null) {
    return { kind: "clear" };
  }
  if (typeof value !== "string") {
    return { kind: "invalid" };
  }
  const title = value.trim();
  if (title.length > MAX_CARD_TITLE_LENGTH) {
    return { kind: "invalid" };
  }
  return title ? { kind: "title", title } : { kind: "clear" };
};
