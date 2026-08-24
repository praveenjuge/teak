// @ts-nocheck
import { describe, expect, mock, test } from "bun:test";
import { repairImageDerivativesHandler } from "../../workflows/derivativeRepair";

describe("derivative repair", () => {
  test("advances candidates before scheduling so one failure cannot starve the queue", async () => {
    const events: string[] = [];
    const cardIds = ["card-a", "card-b"];
    const result = await repairImageDerivativesHandler({
      runQuery: mock(async () => cardIds),
      runMutation: mock((_reference, args) => {
        events.push(`marked:${args.cardIds.join(",")}`);
      }),
      scheduler: {
        runAfter: mock((_delay, _reference, args) => {
          events.push(`scheduled:${args.cardId}`);
        }),
      },
    });

    expect(result).toEqual({ scheduled: 2 });
    expect(events).toEqual([
      "marked:card-a,card-b",
      "scheduled:card-a",
      "scheduled:card-b",
    ]);
  });

  test("does not write or schedule when no candidates need repair", async () => {
    const runMutation = mock();
    const runAfter = mock();
    expect(
      await repairImageDerivativesHandler({
        runQuery: mock(async () => []),
        runMutation,
        scheduler: { runAfter },
      })
    ).toEqual({ scheduled: 0 });
    expect(runMutation).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });
});
