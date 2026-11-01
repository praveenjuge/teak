import {
  CARD_LINK_PATTERN,
  formatCardLinkToken,
} from "@teak/convex/shared/cardLinks";
import { Node } from "@tiptap/core";

const TOKEN_AT_START = new RegExp(`^${CARD_LINK_PATTERN.source}`);

export const cardLinkMarkdown = (cardId: string, title: string): string => {
  const token = `[[${title}|teak:${cardId}]]`;
  const match = TOKEN_AT_START.exec(token);
  return match?.[0] === token ? token : formatCardLinkToken(title, cardId);
};

export const CardLinkNode = Node.create({
  name: "cardLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes: () => ({
    cardId: { default: "" },
    title: { default: "" },
  }),
  parseHTML: () => [
    {
      tag: "span[data-card-link]",
      getAttrs: (element) => ({
        cardId: element.getAttribute("data-card-id") ?? "",
        title: element.textContent ?? "",
      }),
    },
  ],
  renderHTML: ({ node }) => [
    "span",
    { "data-card-id": node.attrs.cardId, "data-card-link": "" },
    node.attrs.title,
  ],
  renderText: ({ node }) => node.attrs.title,
  markdownTokenName: "cardLink",
  markdownTokenizer: {
    name: "cardLink",
    level: "inline",
    start: (src) => src.indexOf("[["),
    tokenize: (src) => {
      const match = TOKEN_AT_START.exec(src);
      if (!match) {
        return;
      }
      return {
        type: "cardLink",
        raw: match[0],
        text: match[1],
        cardId: match[2],
        title: match[1],
      };
    },
  },
  parseMarkdown: (token) => ({
    type: "cardLink",
    attrs: { cardId: token.cardId, title: token.title },
  }),
  renderMarkdown: (node) =>
    cardLinkMarkdown(
      String(node.attrs?.cardId ?? ""),
      String(node.attrs?.title ?? "")
    ),
});
