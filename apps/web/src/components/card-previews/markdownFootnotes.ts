import type { TokenizerAndRendererExtension, Tokens } from "marked";

// GFM footnotes, which marked leaves out. The server reads the reader's
// text through a parser that has them, so the renderer must show them too.

export interface FootnoteRefToken extends Tokens.Generic {
  label: string;
  type: "footnoteRef";
}

export interface FootnoteDefToken extends Tokens.Generic {
  label: string;
  tokens: Tokens.Generic[];
  type: "footnoteDef";
}

const DEFINITION =
  /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?:[ \t]*\n)*(?:[ \t]{4}|\t)[^\n]*)*)(?:\n|$)/u;
const REFERENCE = /^\[\^([^\]\s]+)\]/u;
const CONTINUATION_INDENT = /\n(?:[ \t]{4}|\t)/gu;

export const footnoteExtensions: TokenizerAndRendererExtension[] = [
  {
    level: "block",
    name: "footnoteDef",
    start: (src) => src.match(/^\[\^[^\]\s]+\]:/mu)?.index,
    tokenizer(src) {
      const match = DEFINITION.exec(src);
      if (!match) {
        return;
      }
      const body = match[2].replace(CONTINUATION_INDENT, "\n").trim();
      return {
        label: match[1],
        raw: match[0],
        tokens: this.lexer.blockTokens(body, []),
        type: "footnoteDef",
      };
    },
  },
  {
    level: "inline",
    name: "footnoteRef",
    start: (src) => src.indexOf("[^"),
    tokenizer(src) {
      const match = REFERENCE.exec(src);
      return match
        ? { label: match[1], raw: match[0], type: "footnoteRef" }
        : undefined;
    },
  },
];
