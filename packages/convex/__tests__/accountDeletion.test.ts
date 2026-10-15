import { describe, expect, test } from "bun:test";
import {
  ACCOUNT_DELETION_DRAIN_BUDGET_MS,
  drainStorageWithinBudget,
} from "../accountDeletion";

const binding = { stateId: "state" as never, generation: 1 };

const drainCtx = (pages: Record<string, number>, msPerPage: number) => {
  let clock = 0;
  const calls: string[] = [];
  return {
    calls,
    now: () => clock,
    ctx: {
      runAction: ((_ref: unknown, args: { kind: string }) => {
        calls.push(args.kind);
        clock += msPerPage;
        if ((pages[args.kind] ?? 0) === 0) {
          return Promise.resolve(true);
        }
        pages[args.kind] -= 1;
        return Promise.resolve(false);
      }) as never,
    },
  };
};

describe("drainStorageWithinBudget", () => {
  test("drains every page of every kind in one call while time remains", async () => {
    const drain = drainCtx({ cards: 40, imports: 2 }, 10);

    expect(
      await drainStorageWithinBudget(
        drain.ctx,
        binding,
        ["cards", "imports"],
        drain.now
      )
    ).toBe(true);
    expect(drain.calls).toEqual([
      ...Array.from({ length: 41 }, () => "cards"),
      "imports",
      "imports",
      "imports",
    ]);
  });

  test("yields once the budget is spent, leaving later pages for the next step", async () => {
    const msPerPage = ACCOUNT_DELETION_DRAIN_BUDGET_MS / 4;
    const drain = drainCtx({ cards: 40, imports: 2 }, msPerPage);

    expect(
      await drainStorageWithinBudget(
        drain.ctx,
        binding,
        ["cards", "imports"],
        drain.now
      )
    ).toBe(false);
    expect(drain.calls).toEqual(["cards", "cards", "cards", "cards"]);
  });
});
