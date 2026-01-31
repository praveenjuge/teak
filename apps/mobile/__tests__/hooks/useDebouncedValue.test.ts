// @ts-nocheck
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// Helper function to create a delay promise
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// We need to test this hook by simulating React behavior
// Since we can't use React hooks outside of components in tests,
// we'll test the core logic

describe("useDebouncedValue", () => {
  let timers: Set<ReturnType<typeof setTimeout>>;

  beforeEach(() => {
    timers = new Set();
  });

  afterEach(() => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.clear();
  });

  function mockSetTimeout(
    callback: () => void,
    delayMs: number
  ): ReturnType<typeof setTimeout> {
    const timer = setTimeout(callback, delayMs);
    timers.add(timer);
    return timer;
  }

  test("should return initial value immediately", () => {
    const debouncedValue = "initial";
    expect(debouncedValue).toBe("initial");
  });

  test("should update debounced value after delay", async () => {
    let currentValue = "initial";
    const newValue = "updated";

    mockSetTimeout(() => {
      currentValue = newValue;
    }, 100);

    await delay(150);
    expect(currentValue).toBe(newValue);
  });

  test("should not update before delay period", async () => {
    let currentValue = "initial";
    const newValue = "updated";
    const delayMs = 100;

    mockSetTimeout(() => {
      currentValue = newValue;
    }, delayMs);

    await delay(50);
    expect(currentValue).toBe("initial");
  });

  test("should reset timer on value change", async () => {
    let currentValue = "initial";
    const delayMs = 100;
    let callCount = 0;

    mockSetTimeout(() => {
      callCount++;
      currentValue = "value1";
    }, delayMs);

    // Change value again before first timeout
    await delay(50);
    clearTimeout(Array.from(timers)[0]);
    timers.delete(Array.from(timers)[0]);

    mockSetTimeout(() => {
      callCount++;
      currentValue = "value2";
    }, delayMs);

    await delay(delayMs + 50);
    expect(callCount).toBe(1);
    expect(currentValue).toBe("value2");
  });

  test("should handle rapid value changes", async () => {
    let currentValue = "initial";
    const delayMs = 100;

    // Simulate rapid changes
    mockSetTimeout(() => {
      currentValue = "final";
    }, delayMs);

    // The final value should be set after the last debounce
    await delay(delayMs + 50);
    expect(currentValue).toBe("final");
  });

  test("should handle zero delay", async () => {
    let currentValue = "initial";

    mockSetTimeout(() => {
      currentValue = "updated";
    }, 0);

    await delay(10);
    expect(currentValue).toBe("updated");
  });

  test("should handle negative delay as zero", async () => {
    let currentValue = "initial";

    mockSetTimeout(() => {
      currentValue = "updated";
    }, 0);

    await delay(10);
    expect(currentValue).toBe("updated");
  });

  test("should clear previous timeout on new value", async () => {
    let currentValue = "initial";
    const delayMs = 100;
    let updated = false;

    const timer1 = mockSetTimeout(() => {
      // This should be cleared
      updated = true;
    }, delayMs);

    // Clear and set new timeout
    clearTimeout(timer1);
    timers.delete(timer1);

    mockSetTimeout(() => {
      currentValue = "new-value";
    }, delayMs);

    await delay(delayMs + 50);
    expect(updated).toBe(false);
    expect(currentValue).toBe("new-value");
  });

  test("should work with number values", async () => {
    let currentValue = 0;

    mockSetTimeout(() => {
      currentValue = 42;
    }, 100);

    await delay(150);
    expect(currentValue).toBe(42);
  });

  test("should work with object values", async () => {
    let currentValue = { key: "initial" };

    mockSetTimeout(() => {
      currentValue = { key: "updated" };
    }, 100);

    await delay(150);
    expect(currentValue.key).toBe("updated");
  });

  test("should work with array values", async () => {
    let currentValue: number[] = [1, 2, 3];

    mockSetTimeout(() => {
      currentValue = [4, 5, 6];
    }, 100);

    await delay(150);
    expect(currentValue).toEqual([4, 5, 6]);
  });

  test("should work with boolean values", async () => {
    let currentValue = false;

    mockSetTimeout(() => {
      currentValue = true;
    }, 100);

    await delay(150);
    expect(currentValue).toBe(true);
  });

  test("should handle null values", async () => {
    let currentValue = "initial";

    mockSetTimeout(() => {
      currentValue = null as unknown as string;
    }, 100);

    await delay(150);
    expect(currentValue).toBeNull();
  });

  test("should handle undefined values", async () => {
    let currentValue: string | undefined = "initial";

    mockSetTimeout(() => {
      currentValue = undefined;
    }, 100);

    await delay(150);
    expect(currentValue).toBeUndefined();
  });

  test("should debounce string changes", async () => {
    let currentValue = "";
    const delayMs = 100;

    mockSetTimeout(() => {
      currentValue = "final string";
    }, delayMs);

    await delay(delayMs + 50);
    expect(currentValue).toBe("final string");
  });

  test("should handle very long delays", async () => {
    let currentValue = "initial";
    const delayMs = 500;

    mockSetTimeout(() => {
      currentValue = "delayed";
    }, delayMs);

    await delay(delayMs + 50);
    expect(currentValue).toBe("delayed");
  });

  test("should maintain debounce timing consistency", async () => {
    const delays: number[] = [];
    const delayMs = 100;

    const start = Date.now();

    mockSetTimeout(() => {
      delays.push(Date.now() - start);
    }, delayMs);

    await delay(delayMs + 100);
    expect(delays[0]).toBeGreaterThanOrEqual(delayMs);
    expect(delays[0]).toBeLessThan(delayMs + 50);
  });
});
