/**
 * Scoring for scripts/clef-eval. Pure, so the numbers it prints are tested.
 */

export const THRESHOLDS = [
  0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95,
];

export interface ChoiceOutcome {
  /** Clef's top answer and its probability. */
  choice: string;
  label: string;
  probability: number;
  /** What the rules answer today, which Clef only replaces when sure. */
  rules: string;
}

export interface ThresholdRow {
  /** Final answers (Clef's or the rules') that match the label. */
  accuracy: number;
  /** How many answers Clef changed. */
  changed: number;
  /** Changes among the items the rules got wrong. */
  coverage: number;
  /** Changes that were right. */
  precision: number;
  threshold: number;
}

/**
 * For each threshold: how often Clef's change is right, how many of the
 * rules' mistakes it fixes, and the accuracy of the answers users would see.
 * `never` lists choices Clef may not change to (link category's `other`).
 */
export const choiceRows = (
  outcomes: readonly ChoiceOutcome[],
  never: readonly string[] = []
): ThresholdRow[] =>
  THRESHOLDS.map((threshold) => {
    let changed = 0;
    let rightChanges = 0;
    let correct = 0;
    const rulesWrong = outcomes.filter((item) => item.rules !== item.label);
    let fixed = 0;
    for (const item of outcomes) {
      const changes =
        item.choice !== item.rules &&
        !never.includes(item.choice) &&
        item.probability >= threshold;
      const final = changes ? item.choice : item.rules;
      if (changes) {
        changed += 1;
        rightChanges += item.choice === item.label ? 1 : 0;
        fixed +=
          item.rules !== item.label && item.choice === item.label ? 1 : 0;
      }
      correct += final === item.label ? 1 : 0;
    }
    return {
      threshold,
      changed,
      precision: changed ? rightChanges / changed : 1,
      coverage: rulesWrong.length ? fixed / rulesWrong.length : 1,
      accuracy: outcomes.length ? correct / outcomes.length : 1,
    };
  });

export interface StyleOutcome {
  labels: readonly string[];
  /** Every style's yes probability. */
  probabilities: Readonly<Record<string, number>>;
}

export interface StyleRow {
  f1: number;
  precision: number;
  recall: number;
  threshold: number;
}

/** Micro precision, recall and F1 of the top `cap` styles over a threshold. */
export const styleRows = (
  outcomes: readonly StyleOutcome[],
  cap = 4
): StyleRow[] =>
  THRESHOLDS.map((threshold) => {
    let truePositives = 0;
    let predicted = 0;
    let actual = 0;
    for (const item of outcomes) {
      const picks = Object.entries(item.probabilities)
        .filter(([, probability]) => probability >= threshold)
        .sort(([, left], [, right]) => right - left)
        .slice(0, cap)
        .map(([style]) => style);
      predicted += picks.length;
      actual += item.labels.length;
      truePositives += picks.filter((style) =>
        item.labels.includes(style)
      ).length;
    }
    const precision = predicted ? truePositives / predicted : 1;
    const recall = actual ? truePositives / actual : 1;
    return {
      threshold,
      precision,
      recall,
      f1:
        precision + recall
          ? (2 * precision * recall) / (precision + recall)
          : 0,
    };
  });

export interface StyleBreakdownRow {
  /** Images labelled with the style. */
  labelled: number;
  precision: number;
  /** Images Clef gave the style. */
  predicted: number;
  recall: number;
  style: string;
}

/**
 * Precision and recall per style at one threshold, after the same top-`cap`
 * cut as `styleRows`, so one weak style can't hide in the overall numbers.
 */
export const styleBreakdown = (
  outcomes: readonly StyleOutcome[],
  threshold: number,
  cap = 4
): StyleBreakdownRow[] => {
  const counts = new Map<
    string,
    { labelled: number; predicted: number; right: number }
  >();
  const countFor = (style: string) => {
    const existing = counts.get(style);
    if (existing) {
      return existing;
    }
    const fresh = { labelled: 0, predicted: 0, right: 0 };
    counts.set(style, fresh);
    return fresh;
  };
  for (const item of outcomes) {
    for (const style of Object.keys(item.probabilities)) {
      countFor(style);
    }
    const picks = Object.entries(item.probabilities)
      .filter(([, probability]) => probability >= threshold)
      .sort(([, left], [, right]) => right - left)
      .slice(0, cap)
      .map(([style]) => style);
    for (const style of item.labels) {
      countFor(style).labelled += 1;
    }
    for (const style of picks) {
      const count = countFor(style);
      count.predicted += 1;
      count.right += item.labels.includes(style) ? 1 : 0;
    }
  }
  return [...counts.entries()]
    .map(([style, count]) => ({
      style,
      labelled: count.labelled,
      predicted: count.predicted,
      precision: count.predicted ? count.right / count.predicted : 1,
      recall: count.labelled ? count.right / count.labelled : 1,
    }))
    .sort((left, right) => left.style.localeCompare(right.style));
};

/** nDCG@k of an order against graded relevance (missing ids count as 0). */
export const ndcgAt = (
  order: readonly string[],
  relevance: Readonly<Record<string, number>>,
  k = 10
): number => {
  const gain = (ids: readonly string[]) =>
    ids
      .slice(0, k)
      .reduce(
        (sum, id, index) =>
          sum + (2 ** (relevance[id] ?? 0) - 1) / Math.log2(index + 2),
        0
      );
  const ideal = gain(
    Object.keys(relevance).sort(
      (left, right) => (relevance[right] ?? 0) - (relevance[left] ?? 0)
    )
  );
  return ideal ? gain(order) / ideal : 1;
};

export const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
    ] ?? 0
  );
};
