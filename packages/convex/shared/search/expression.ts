import type { CardType } from "../constants";
import { isHiddenTagList } from "../tags";
import { SEARCH_TOKEN_TRIM_CHARACTERS } from "./constants";
import {
  matchesDoneState,
  matchesImageText,
  matchesPriceBounds,
  matchesSearchPhrases,
  type ParsedSearchQuery,
  parsePriceBound,
  type SearchExpression,
  type SearchQualifier,
} from "./qualifiers";

export interface ExpressionCard {
  aiOcrText?: string;
  completedAt?: number;
  isArchived?: boolean;
  isFavorited?: boolean;
  metadata?: {
    linkCategory?: { category?: string; price?: { amount?: number } };
  };
  pinPosition?: number;
  type: CardType;
}

export interface ExpressionContext {
  folder: (nameKey: string) => boolean;
  hasTag: (tag: string) => boolean;
  host: string | null;
}

const trimWord = (value: string) => {
  let start = 0;
  let end = value.length;
  while (
    start < end &&
    SEARCH_TOKEN_TRIM_CHARACTERS.includes(value.charAt(start))
  ) {
    start += 1;
  }
  while (
    end > start &&
    SEARCH_TOKEN_TRIM_CHARACTERS.includes(value.charAt(end - 1))
  ) {
    end -= 1;
  }
  return value.slice(start, end).toLowerCase();
};

export const cardMatchesQualifier = (
  card: ExpressionCard,
  qualifier: SearchQualifier,
  context: ExpressionContext
): boolean => {
  switch (qualifier.key) {
    case "tag":
      return context.hasTag(qualifier.value);
    case "type":
      return card.type === qualifier.value;
    case "site":
      return context.host === qualifier.value;
    case "folder":
      return context.folder(qualifier.value.trim().toLowerCase());
    case "is":
      switch (qualifier.value) {
        case "fav":
          return card.isFavorited === true;
        case "archived":
          return card.isArchived === true;
        case "pinned":
          return card.pinPosition !== undefined;
        case "done":
          return (
            card.type === "link" &&
            matchesDoneState(card, { done: true, todo: false })
          );
        default:
          return (
            card.type === "link" &&
            matchesDoneState(card, { done: false, todo: true })
          );
      }
    case "price": {
      const bound = parsePriceBound(qualifier.value);
      return (
        bound !== null &&
        card.type === "link" &&
        matchesPriceBounds(card.metadata?.linkCategory?.price?.amount, [bound])
      );
    }
    case "text":
      return matchesImageText(card.aiOcrText, [qualifier.value]);
    default:
      // `like:` and `mood:` are never inside an expression.
      return true;
  }
};

/**
 * Whether a card meets an expression. A word matches as a substring of the
 * card's searchable text, ignoring case and edge punctuation, so `-design`
 * also leaves out "designer".
 */
export const matchesExpression = (
  expression: SearchExpression,
  card: ExpressionCard,
  searchableText: string,
  context: ExpressionContext,
  /**
   * The card is hidden and nothing outside the expression reveals it: it
   * matches only through a branch that asks for one of its hidden tags, so
   * `(tag:hidden is:fav) OR tag:x` never shows it through `tag:x`.
   */
  hiddenCard = false
): boolean => {
  const text = searchableText.toLowerCase();
  const evaluate = (node: SearchExpression): boolean => {
    switch (node.op) {
      case "term": {
        const word = trimWord(node.value);
        return word === "" || text.includes(word);
      }
      case "phrase":
        return matchesSearchPhrases(text, [node.value]);
      case "qualifier":
        return cardMatchesQualifier(card, node.qualifier, context);
      case "not":
        return !evaluate(node.item);
      case "and":
        return node.items.every(evaluate);
      default:
        return node.items.some(evaluate);
    }
  };
  const reveals = (node: SearchExpression, negated: boolean): boolean => {
    switch (node.op) {
      case "qualifier":
        return (
          !negated &&
          node.qualifier.key === "tag" &&
          isHiddenTagList([node.qualifier.value]) &&
          evaluate(node)
        );
      case "not":
        return reveals(node.item, !negated);
      case "and":
      case "or": {
        const everyItem = (node.op === "and") !== negated;
        return everyItem
          ? node.items.every((item) => evaluate(item) !== negated) &&
              node.items.some((item) => reveals(item, negated))
          : node.items.some((item) => reveals(item, negated));
      }
      default:
        return false;
    }
  };
  return hiddenCard ? reveals(expression, false) : evaluate(expression);
};

const walkQualifiers = (
  expression: SearchExpression | undefined,
  visit: (qualifier: SearchQualifier, excluded: boolean) => void,
  excluded = false
) => {
  if (!expression) {
    return;
  }
  switch (expression.op) {
    case "qualifier":
      visit(expression.qualifier, excluded);
      return;
    case "not":
      walkQualifiers(expression.item, visit, !excluded);
      return;
    case "and":
    case "or":
      for (const item of expression.items) {
        walkQualifiers(item, visit, excluded);
      }
      return;
    default:
      return;
  }
};

export const expressionFolderNames = (
  expression: SearchExpression | undefined
): string[] => {
  const names = new Set<string>();
  walkQualifiers(expression, (qualifier) => {
    if (qualifier.key === "folder") {
      names.add(qualifier.value.trim().toLowerCase());
    }
  });
  return [...names];
};

/**
 * The hidden tags an expression asks for (never excluded ones), so
 * `tag:hidden OR tag:x` can reveal hidden cards and `-tag:hidden` can't.
 */
export const expressionRevealTags = (
  expression: SearchExpression | undefined
): string[] => {
  const tags: string[] = [];
  walkQualifiers(expression, (qualifier, excluded) => {
    if (
      qualifier.key === "tag" &&
      !excluded &&
      isHiddenTagList([qualifier.value])
    ) {
      tags.push(qualifier.value);
    }
  });
  return tags;
};

export const expressionWantsArchived = (
  expression: SearchExpression | undefined
): boolean => {
  let wants = false;
  walkQualifiers(expression, (qualifier, excluded) => {
    if (qualifier.key === "is" && qualifier.value === "archived" && !excluded) {
      wants = true;
    }
  });
  return wants;
};

export const expressionIndexWords = (
  expression: SearchExpression | undefined
): string[] => {
  if (!expression) {
    return [];
  }
  switch (expression.op) {
    case "term":
    case "phrase":
      return [expression.value];
    case "and":
    case "or":
      return expression.items.flatMap(expressionIndexWords);
    default:
      return [];
  }
};

export const expressionReadsImageText = (
  expression: SearchExpression | undefined
): boolean => {
  let reads = false;
  walkQualifiers(expression, (qualifier) => {
    if (qualifier.key === "text") {
      reads = true;
    }
  });
  return reads;
};

export const expressionHasWords = (
  expression: SearchExpression | undefined
): boolean => {
  if (!expression) {
    return false;
  }
  switch (expression.op) {
    case "term":
    case "phrase":
      return true;
    case "not":
      return expressionHasWords(expression.item);
    case "and":
    case "or":
      return expression.items.some(expressionHasWords);
    default:
      return false;
  }
};

export const searchOperatorsUsed = (
  parsed: Pick<
    ParsedSearchQuery,
    "expression" | "phrases" | "qualifiers" | "terms"
  >
): { groups: boolean; negation: boolean; or: boolean } => {
  const used = { groups: false, negation: false, or: false };
  const visit = (
    node: SearchExpression,
    parent: SearchExpression["op"] | null
  ) => {
    if (node.op === "not") {
      used.negation = true;
      if (node.item.op === "and" || node.item.op === "or") {
        used.groups = true;
      }
      visit(node.item, "not");
    } else if (node.op === "and" || node.op === "or") {
      if (node.op === "or") {
        used.or = true;
        if (parent === "and") {
          used.groups = true;
        }
      }
      for (const item of node.items) {
        visit(item, node.op);
      }
    }
  };
  if (parsed.expression) {
    const lifted =
      parsed.qualifiers.length + parsed.phrases.length + parsed.terms.length;
    visit(parsed.expression, lifted > 0 ? "and" : null);
  }
  return used;
};
