import { describe, expect, test } from "bun:test";
import { type StepContext, type Steps, stepPages } from "./runtime";

const recordingSteps = () => {
  const names: string[] = [];
  const steps: Steps = {
    do: (<T>(
      name: string,
      configOrBody: unknown,
      body?: (ctx: StepContext) => Promise<T>
    ) => {
      names.push(name);
      return (body ?? (configOrBody as (ctx: StepContext) => Promise<T>))({
        attempt: 1,
      });
    }) as Steps["do"],
    sleep: () => Promise.resolve(),
  };
  return { names, steps };
};

const CONFIG = { retries: { delay: 0, limit: 0 } };

describe("stepPages", () => {
  // Step names are workflow history: an in-flight run replays by them.
  test("names each page's step `<name> <page>`, from 1", async () => {
    const { names, steps } = recordingSteps();
    const pages: number[] = [];
    for await (const page of stepPages(steps, "index page", CONFIG, (n) =>
      Promise.resolve(n)
    )) {
      pages.push(page);
      if (page === 3) {
        break;
      }
    }
    expect(names).toEqual(["index page 1", "index page 2", "index page 3"]);
    expect(pages).toEqual([1, 2, 3]);
  });

  test("carries on from a page a resumed run had reached", async () => {
    const { names, steps } = recordingSteps();
    for await (const page of stepPages(
      steps,
      "index page",
      CONFIG,
      (n) => Promise.resolve(n),
      { firstPage: 4 }
    )) {
      if (page === 5) {
        break;
      }
    }
    expect(names).toEqual(["index page 4", "index page 5"]);
  });

  test("stops after maxPages pages", async () => {
    const { names, steps } = recordingSteps();
    const results: boolean[] = [];
    for await (const more of stepPages(
      steps,
      "clean up cards",
      CONFIG,
      () => Promise.resolve(true),
      { maxPages: 2 }
    )) {
      results.push(more);
    }
    expect(names).toEqual(["clean up cards 1", "clean up cards 2"]);
    expect(results).toEqual([true, true]);
  });
});
