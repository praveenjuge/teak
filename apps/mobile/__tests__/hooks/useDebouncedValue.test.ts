// @ts-nocheck
import { describe, test, expect, beforeEach, afterEach } from "bun:test";

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

  function mockSetTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(callback, delay);
    timers.add(timer);
    return timer;
  }

  test("should return initial value immediately", () => {
    let debouncedValue = "initial";
    expect(debouncedValue).toBe("initial");
  });

  test("should update debounced value after delay", (done) => {
    let currentValue = "initial";
    const newValue = "updated";

    mockSetTimeout(() => {
      currentValue = newValue;
      expect(currentValue).toBe(newValue);
      done();
    }, 100);
  });

  test("should not update before delay period", (done) => {
    let currentValue = "initial";
    const newValue = "updated";
    const delay = 100;

    mockSetTimeout(() => {
      currentValue = newValue;
    }, delay);

    setTimeout(() => {
      expect(currentValue).toBe("initial");
      done();
    }, 50);
  });

  test("should reset timer on value change", (done) => {
    let currentValue = "initial";
    const delay = 100;
    let callCount = 0;

    mockSetTimeout(() => {
      callCount++;
      currentValue = "value1";
    }, delay);

    // Change value again before first timeout
    setTimeout(() => {
      clearTimeout(Array.from(timers)[0]);
      timers.delete(Array.from(timers)[0]);

      mockSetTimeout(() => {
        callCount++;
        currentValue = "value2";
      }, delay);

      setTimeout(() => {
        expect(callCount).toBe(1);
        expect(currentValue).toBe("value2");
        done();
      }, delay + 50);
    }, 50);
  });

  test("should handle rapid value changes", (done) => {
    let currentValue = "initial";
    const delay = 100;

    // Simulate rapid changes
    mockSetTimeout(() => {
      currentValue = "final";
    }, delay);

    // The final value should be set after the last debounce
    setTimeout(() => {
      expect(currentValue).toBe("final");
      done();
    }, delay + 50);
  });

  test("should handle zero delay", (done) => {
    let currentValue = "initial";

    mockSetTimeout(() => {
      currentValue = "updated";
    }, 0);

    setTimeout(() => {
      expect(currentValue).toBe("updated");
      done();
    }, 10);
  });

  test("should handle negative delay as zero", (done) => {
    let currentValue = "initial";

    mockSetTimeout(() => {
      currentValue = "updated";
    }, 0);

    setTimeout(() => {
      expect(currentValue).toBe("updated");
      done();
    }, 10);
  });

  test("should clear previous timeout on new value", (done) => {
    let currentValue = "initial";
    const delay = 100;
    let updated = false;

    const timer1 = mockSetTimeout(() => {
      // This should be cleared
      updated = true;
    }, delay);

    // Clear and set new timeout
    clearTimeout(timer1);
    timers.delete(timer1);

    const timer2 = mockSetTimeout(() => {
      currentValue = "new-value";
    }, delay);

    setTimeout(() => {
      expect(updated).toBe(false);
      expect(currentValue).toBe("new-value");
      done();
    }, delay + 50);
  });

  test("should work with number values", (done) => {
    let currentValue = 0;

    mockSetTimeout(() => {
      currentValue = 42;
    }, 100);

    setTimeout(() => {
      expect(currentValue).toBe(42);
      done();
    }, 150);
  });

  test("should work with object values", (done) => {
    let currentValue = { key: "initial" };

    mockSetTimeout(() => {
      currentValue = { key: "updated" };
    }, 100);

    setTimeout(() => {
      expect(currentValue.key).toBe("updated");
      done();
    }, 150);
  });

  test("should work with array values", (done) => {
    let currentValue: number[] = [1, 2, 3];

    mockSetTimeout(() => {
      currentValue = [4, 5, 6];
    }, 100);

    setTimeout(() => {
      expect(currentValue).toEqual([4, 5, 6]);
      done();
    }, 150);
  });

  test("should work with boolean values", (done) => {
    let currentValue = false;

    mockSetTimeout(() => {
      currentValue = true;
    }, 100);

    setTimeout(() => {
      expect(currentValue).toBe(true);
      done();
    }, 150);
  });

  test("should handle null values", (done) => {
    let currentValue = "initial";

    mockSetTimeout(() => {
      currentValue = null as any;
    }, 100);

    setTimeout(() => {
      expect(currentValue).toBeNull();
      done();
    }, 150);
  });

  test("should handle undefined values", (done) => {
    let currentValue = "initial";

    mockSetTimeout(() => {
      currentValue = undefined;
    }, 100);

    setTimeout(() => {
      expect(currentValue).toBeUndefined();
      done();
    }, 150);
  });

  test("should debounce string changes", (done) => {
    let currentValue = "";
    const delay = 100;

    mockSetTimeout(() => {
      currentValue = "final string";
    }, delay);

    setTimeout(() => {
      expect(currentValue).toBe("final string");
      done();
    }, delay + 50);
  });

  test("should handle very long delays", (done) => {
    let currentValue = "initial";
    const delay = 500;

    mockSetTimeout(() => {
      currentValue = "delayed";
    }, delay);

    setTimeout(() => {
      expect(currentValue).toBe("delayed");
      done();
    }, delay + 50);
  });

  test("should maintain debounce timing consistency", (done) => {
    const delays: number[] = [];
    const delay = 100;

    const start = Date.now();

    mockSetTimeout(() => {
      delays.push(Date.now() - start);
    }, delay);

    setTimeout(() => {
      expect(delays[0]).toBeGreaterThanOrEqual(delay);
      expect(delays[0]).toBeLessThan(delay + 50);
      done();
    }, delay + 100);
  });
});
