import { describe, expect, test } from "bun:test";
import {
  applyTagOperationToSummary,
  explainTagNameInput,
  isTagOperationStalled,
  TAG_OPERATION_OVERLAY_MS,
  type TagOperationView,
  tagOperationDescription,
  tagOperationTitle,
} from "../tags";

const items = [
  { name: "design", count: 5 },
  { name: "web", count: 3 },
  { name: "ux", count: 2 },
];

const operation = (
  overrides: Partial<TagOperationView> = {}
): TagOperationView => ({
  _id: "op1",
  kind: "rename",
  from: "design",
  to: "Design Systems",
  status: "running",
  total: 300,
  processed: 0,
  changed: 120,
  ...overrides,
});

describe("applyTagOperationToSummary", () => {
  test("a rename moves the count to the new name, re-sorted", () => {
    expect(applyTagOperationToSummary(items, operation())).toEqual([
      { name: "design systems", count: 5 },
      { name: "web", count: 3 },
      { name: "ux", count: 2 },
    ]);
  });

  test("a merge adds the count to the target", () => {
    expect(
      applyTagOperationToSummary(
        items,
        operation({ kind: "merge", from: "ux", to: "web" })
      )
    ).toEqual([
      { name: "design", count: 5 },
      { name: "web", count: 5 },
    ]);
  });

  test("a delete drops the tag", () => {
    expect(
      applyTagOperationToSummary(
        items,
        operation({ kind: "delete", from: "web", to: undefined })
      ).map((item) => item.name)
    ).toEqual(["design", "ux"]);
  });

  test("leaves the list alone once the counts have caught up, or after a failure", () => {
    const now = 1_000_000;
    expect(
      applyTagOperationToSummary(
        items,
        operation({
          status: "completed",
          completedAt: now - TAG_OPERATION_OVERLAY_MS - 1,
        }),
        now
      )
    ).toEqual(items);
    expect(
      applyTagOperationToSummary(items, operation({ status: "failed" }))
    ).toEqual(items);
    expect(
      applyTagOperationToSummary(
        items,
        operation({ updatedAt: now - 121_000 }),
        now
      )
    ).toEqual(items);
    expect(
      applyTagOperationToSummary(items, operation({ from: "missing" }))
    ).toEqual(items);
    expect(
      applyTagOperationToSummary(items, operation({ to: "Design" }))
    ).toEqual(items);
  });
});

describe("isTagOperationStalled", () => {
  test("a running change with no progress for two minutes has stopped", () => {
    const now = 10_000_000;
    expect(
      isTagOperationStalled(operation({ updatedAt: now - 121_000 }), now)
    ).toBe(true);
    expect(
      isTagOperationStalled(operation({ updatedAt: now - 30_000 }), now)
    ).toBe(false);
    expect(
      isTagOperationStalled(
        operation({ status: "completed", updatedAt: now - 600_000 }),
        now
      )
    ).toBe(false);
  });
});

describe("tag operation copy", () => {
  test("titles and progress for each state", () => {
    expect(tagOperationTitle(operation())).toBe(
      "Renaming “design” to “Design Systems”…"
    );
    expect(tagOperationDescription(operation())).toBe(
      "120 of 300 cards changed"
    );
    expect(
      tagOperationTitle(operation({ kind: "merge", status: "completed" }))
    ).toBe("Merged “design” into “Design Systems”");
    expect(
      tagOperationDescription(operation({ status: "completed", changed: 1 }))
    ).toBe("1 card changed");
    expect(tagOperationTitle(operation({ status: "failed" }))).toBe(
      "Couldn't finish renaming. 120 of 300 cards changed."
    );
    expect(
      tagOperationTitle(
        operation({ kind: "delete", to: undefined, status: "completed" })
      )
    ).toBe("Deleted “design”");
  });

  test("new names must be 1 to 64 characters", () => {
    expect(explainTagNameInput("  ")).toBe("Name the tag");
    expect(explainTagNameInput("x".repeat(65))).toBe(
      "Tags can be at most 64 characters"
    );
    expect(explainTagNameInput("ok")).toBeNull();
  });
});
