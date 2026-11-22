import { decodeNamedCharacterReference } from "decode-named-character-reference";
import { Marked, type Token, type Tokens } from "marked";
import { decodeNumericCharacterReference } from "micromark-util-decode-numeric-character-reference";
import { Children, type ReactNode } from "react";
import {
  type FootnoteDefToken,
  type FootnoteRefToken,
  footnoteExtensions,
} from "./markdownFootnotes";

/**
 * Markdown as React elements, straight from marked's tokens. Nothing goes
 * through `dangerouslySetInnerHTML`, so raw HTML tokens are dropped (their
 * inner text stays, as it did under react-markdown) and a link is only
 * kept over http, https, mailto or a relative address.
 *
 * Whitespace between blocks follows the Markdown-to-HTML tree the server
 * reads reader text from (`markdownToReaderText`), so the text the reader
 * shows and the text highlights anchor to stay the same.
 */

export interface MarkdownImage {
  alt: string;
  src: string;
  title?: string;
}

export interface MarkdownRenderOptions {
  /** A fenced or indented code block. `code` ends with a newline. */
  codeBlock?: (block: { code: string; language?: string }) => ReactNode;
  /** Moves a level-one heading down to level two. */
  demoteH1?: boolean;
  /** Renders an image; the default only keeps http, https and relative src. */
  image?: (image: MarkdownImage) => ReactNode;
  /** Renders a link whose href is already known to be safe. */
  link?: (link: { children: ReactNode; href: string }) => ReactNode;
  /** Drops an opening heading that repeats this title. */
  openingTitle?: string;
  /** Wraps a finished `<table>`. */
  table?: (table: ReactNode) => ReactNode;
}

const marked = new Marked({ extensions: footnoteExtensions, gfm: true });

const NEWLINE = "\n";
const FOOTNOTES_LABEL = "Footnotes";
const BACK_LABEL = "Back to reference ";
const BACK_ARROW = "\u21a9";
const SCHEME = /^([^/?#:]*):/u;
const WHITESPACE = /\s+/gu;
// The character references CommonMark decodes, as micromark (and so the
// server's markdownToReaderText) finds them: every HTML5 named entity and
// decimal or hex references, with the same rules for invalid code points.
const ENTITY = /&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/giu;

const decodeEntities = (text: string): string =>
  text.replace(ENTITY, (match, reference: string) => {
    if (reference.startsWith("#")) {
      const hex = reference[1] === "x" || reference[1] === "X";
      return decodeNumericCharacterReference(
        reference.slice(hex ? 2 : 1),
        hex ? 16 : 10
      );
    }
    return decodeNamedCharacterReference(reference) || match;
  });

const hasScheme = (url: string, allowed: readonly string[]): boolean => {
  const scheme = SCHEME.exec(url)?.[1];
  return scheme === undefined || allowed.includes(scheme.toLowerCase());
};

const isSafeHref = (href: string) =>
  hasScheme(href.trim(), ["http", "https", "mailto"]);
const isSafeSrc = (src: string) => hasScheme(src.trim(), ["http", "https"]);

interface Context {
  definitions: Map<string, FootnoteDefToken>;
  footnoteOrder: string[];
  options: MarkdownRenderOptions;
  referenceCounts: Map<string, number>;
}

// GFM matches a footnote reference to its definition ignoring case and runs
// of whitespace, as micromark-util-normalize-identifier does on the server.
const footnoteKey = (label: string) =>
  label
    .replace(/[\t\n\r ]+/gu, " ")
    .trim()
    .toLowerCase()
    .toUpperCase();

const footnoteId = (label: string) => encodeURIComponent(label.toLowerCase());

const plainText = (tokens: Token[] | undefined): string =>
  (tokens ?? [])
    .map((token) => {
      switch (token.type) {
        case "text":
          return token.tokens
            ? plainText(token.tokens)
            : decodeEntities(token.text);
        case "codespan":
        case "escape":
          return token.text;
        case "br":
          return NEWLINE;
        case "image":
        case "html":
        case "footnoteRef":
          return "";
        default:
          return plainText((token as Tokens.Generic).tokens);
      }
    })
    .join("");

const normalizeTitle = (text: string) =>
  text.replace(WHITESPACE, " ").trim().toLocaleLowerCase();

const keyed = (nodes: ReactNode[]) => Children.toArray(nodes);

const defaultImage = ({ alt, src, title }: MarkdownImage) =>
  isSafeSrc(src) ? (
    // biome-ignore lint/correctness/useImageSize: the source's size is unknown
    <img alt={alt} src={src} title={title} />
  ) : null;

const defaultCodeBlock = ({
  code,
  language,
}: {
  code: string;
  language?: string;
}) => (
  <pre>
    <code className={language ? `language-${language}` : undefined}>
      {code}
    </code>
  </pre>
);

function footnoteReference(token: FootnoteRefToken, context: Context) {
  const label = footnoteKey(token.label);
  if (!context.definitions.has(label)) {
    return `[^${token.label}]`;
  }
  let index = context.footnoteOrder.indexOf(label);
  if (index < 0) {
    index = context.footnoteOrder.push(label) - 1;
  }
  const count = (context.referenceCounts.get(label) ?? 0) + 1;
  context.referenceCounts.set(label, count);
  const id = footnoteId(label);
  return (
    <sup>
      <a
        aria-describedby="user-content-footnote-label"
        data-footnote-ref=""
        href={`#user-content-fn-${id}`}
        id={`user-content-fnref-${id}${count > 1 ? `-${count}` : ""}`}
      >
        {index + 1}
      </a>
    </sup>
  );
}

function renderInlineToken(token: Token, context: Context): ReactNode {
  switch (token.type) {
    case "text":
      return token.tokens
        ? renderInline(token.tokens, context)
        : decodeEntities(token.text);
    case "escape":
      return token.text;
    case "strong":
      return <strong>{renderInline(token.tokens, context)}</strong>;
    case "em":
      return <em>{renderInline(token.tokens, context)}</em>;
    case "del":
      return <del>{renderInline(token.tokens, context)}</del>;
    case "codespan":
      return <code>{token.text}</code>;
    case "br":
      return (
        <>
          <br />
          {NEWLINE}
        </>
      );
    case "link": {
      const children = renderInline(token.tokens, context);
      const { href } = token as Tokens.Link;
      if (!isSafeHref(href)) {
        return children;
      }
      return context.options.link ? (
        context.options.link({ children, href })
      ) : (
        <a href={href}>{children}</a>
      );
    }
    case "image": {
      const { href, title, text } = token as Tokens.Image;
      const render = context.options.image ?? defaultImage;
      return render({
        alt: decodeEntities(text),
        src: href,
        title: title ?? undefined,
      });
    }
    case "footnoteRef":
      return footnoteReference(token as FootnoteRefToken, context);
    case "html":
      return null;
    default:
      return typeof (token as Tokens.Generic).text === "string"
        ? (token as Tokens.Generic).text
        : null;
  }
}

function renderInline(
  tokens: Token[] | undefined,
  context: Context
): ReactNode[] {
  return keyed(
    (tokens ?? []).map((token) => renderInlineToken(token, context))
  );
}

function renderListItem(item: Tokens.ListItem, context: Context): ReactNode {
  const children = item.tokens.filter((token) => token.type !== "space");
  const nodes: ReactNode[] = [];
  children.forEach((child, index) => {
    const isText = child.type === "text" || child.type === "paragraph";
    if (child.type === "checkbox") {
      nodes.push(
        <input
          defaultChecked={(child as Tokens.Checkbox).checked}
          disabled
          type="checkbox"
        />,
        " "
      );
      return;
    }
    if (item.loose || !isText || index > 0) {
      nodes.push(NEWLINE);
    }
    nodes.push(
      isText && !item.loose
        ? renderInline(child.tokens, context)
        : renderBlock(child, context)
    );
  });
  const tail = children.at(-1);
  if (
    item.loose ||
    (tail && tail.type !== "text" && tail.type !== "paragraph")
  ) {
    nodes.push(NEWLINE);
  }
  return (
    <li className={item.task ? "task-list-item" : undefined}>{keyed(nodes)}</li>
  );
}

function renderList(list: Tokens.List, context: Context): ReactNode {
  const items = keyed(
    list.items
      .flatMap((item) => [NEWLINE, renderListItem(item, context)])
      .concat(NEWLINE)
  );
  const className = list.items.some((item) => item.task)
    ? "contains-task-list"
    : undefined;
  return list.ordered ? (
    <ol
      className={className}
      start={list.start === 1 ? undefined : Number(list.start)}
    >
      {items}
    </ol>
  ) : (
    <ul className={className}>{items}</ul>
  );
}

function renderTable(table: Tokens.Table, context: Context): ReactNode {
  const cell = (
    { align, header, tokens }: Tokens.TableCell,
    index: number
  ): ReactNode => {
    const children = renderInline(tokens, context);
    const cellAlign = align ?? undefined;
    return header ? (
      <th align={cellAlign} key={index}>
        {children}
      </th>
    ) : (
      <td align={cellAlign} key={index}>
        {children}
      </td>
    );
  };
  const element = (
    <table>
      <thead>
        <tr>{table.header.map(cell)}</tr>
      </thead>
      {table.rows.length > 0 ? (
        <tbody>
          {table.rows.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
            <tr key={index}>{row.map(cell)}</tr>
          ))}
        </tbody>
      ) : null}
    </table>
  );
  return context.options.table ? context.options.table(element) : element;
}

function renderCodeBlock(token: Tokens.Code, context: Context): ReactNode {
  const language = token.lang?.trim().split(WHITESPACE)[0] || undefined;
  const render = context.options.codeBlock ?? defaultCodeBlock;
  return render({ code: `${token.text}\n`, language });
}

function renderBlock(token: Token, context: Context): ReactNode {
  switch (token.type) {
    case "paragraph":
      return <p>{renderInline(token.tokens, context)}</p>;
    case "text":
      return renderInline(token.tokens ?? [token], context);
    case "heading": {
      const depth =
        token.depth === 1 && context.options.demoteH1 ? 2 : token.depth;
      const Heading = `h${depth}` as "h1";
      return <Heading>{renderInline(token.tokens, context)}</Heading>;
    }
    case "blockquote":
      return (
        <blockquote>
          {renderBlocks(token.tokens ?? [], context, true)}
        </blockquote>
      );
    case "list":
      return renderList(token as Tokens.List, context);
    case "table":
      return renderTable(token as Tokens.Table, context);
    case "code":
      return renderCodeBlock(token as Tokens.Code, context);
    case "hr":
      return <hr />;
    case "space":
    case "def":
    case "html":
    case "footnoteDef":
      return null;
    default:
      return typeof (token as Tokens.Generic).text === "string"
        ? (token as Tokens.Generic).text
        : null;
  }
}

function renderBlocks(
  tokens: Token[],
  context: Context,
  around = false
): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (const token of tokens) {
    const node = renderBlock(token, context);
    if (node === null) {
      continue;
    }
    if (around || nodes.length > 0) {
      nodes.push(NEWLINE);
    }
    nodes.push(node);
  }
  if (around && nodes.length > 0) {
    nodes.push(NEWLINE);
  }
  return keyed(nodes);
}

function renderBackReferences(label: string, context: Context): ReactNode[] {
  const id = footnoteId(label);
  const count = context.referenceCounts.get(label) ?? 1;
  const links: ReactNode[] = [];
  for (let reference = 1; reference <= count; reference++) {
    const suffix = reference > 1 ? `-${reference}` : "";
    links.push(
      reference > 1 ? " " : null,
      <a
        aria-label={[BACK_LABEL, id, suffix].join("")}
        className="data-footnote-backref"
        data-footnote-backref=""
        href={`#user-content-fnref-${id}${suffix}`}
      >
        {BACK_ARROW}
        {reference > 1 ? <sup>{reference}</sup> : null}
      </a>
    );
  }
  return keyed(links);
}

function renderFootnotes(context: Context): ReactNode {
  const items: ReactNode[] = [];
  // Rendering a note can reference another, which grows the order.
  // biome-ignore lint/style/useForOf: the order grows while it is walked
  for (let index = 0; index < context.footnoteOrder.length; index++) {
    const label = context.footnoteOrder[index];
    const tokens = (context.definitions.get(label)?.tokens ?? []).filter(
      (token) => token.type !== "space"
    );
    const tail = tokens.at(-1);
    const body = tokens.map((token) =>
      token === tail && token.type === "paragraph" ? (
        <p key={label}>
          {renderInline(token.tokens, context)}{" "}
          {renderBackReferences(label, context)}
        </p>
      ) : (
        renderBlock(token, context)
      )
    );
    if (tail?.type !== "paragraph") {
      body.push(<p>{renderBackReferences(label, context)}</p>);
    }
    items.push(
      NEWLINE,
      <li id={`user-content-fn-${footnoteId(label)}`}>
        {NEWLINE}
        {body.flatMap((node) => [node, NEWLINE])}
      </li>
    );
  }
  return (
    <section className="footnotes" data-footnotes="">
      <h2 className="sr-only" id="user-content-footnote-label">
        {/* The server reads this exact label in the reader text. */}
        {FOOTNOTES_LABEL}
      </h2>
      {NEWLINE}
      <ol>{keyed([...items, NEWLINE])}</ol>
    </section>
  );
}

const openingBlock = (tokens: Token[]): Token | undefined =>
  tokens.find(
    (token) =>
      token.type !== "space" &&
      token.type !== "def" &&
      token.type !== "html" &&
      token.type !== "footnoteDef"
  );

export function renderMarkdown(
  source: string,
  options: MarkdownRenderOptions = {}
): ReactNode {
  const tokens = marked.lexer(source);
  const definitions = new Map<string, FootnoteDefToken>();
  for (const token of tokens) {
    const key = token.type === "footnoteDef" ? footnoteKey(token.label) : null;
    if (key !== null && !definitions.has(key)) {
      definitions.set(key, token as FootnoteDefToken);
    }
  }
  const context: Context = {
    definitions,
    footnoteOrder: [],
    options,
    referenceCounts: new Map(),
  };

  const opening = openingBlock(tokens);
  const blocks =
    options.openingTitle &&
    opening?.type === "heading" &&
    // A heading compared with the card's title, not a secret.
    // nosemgrep
    normalizeTitle(plainText(opening.tokens)) ===
      normalizeTitle(options.openingTitle)
      ? tokens.filter((token) => token !== opening)
      : tokens;

  const content = renderBlocks(blocks, context);
  return (
    <>
      {content}
      {context.footnoteOrder.length > 0 ? (
        <>
          {content.length > 0 ? NEWLINE : null}
          {renderFootnotes(context)}
        </>
      ) : null}
    </>
  );
}
