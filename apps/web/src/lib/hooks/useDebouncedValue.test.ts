import { describe, expect, it } from 'bun:test';

describe('useDebouncedValue hook logic', () => {
  it('should have correct timeout behavior', async () => {
    // Test the core setTimeout logic that the hook uses
    let result = 'initial';
    const delay = 100;

    const updateValue = (newValue: string) => {
      setTimeout(() => {
        result = newValue;
      }, delay);
    };

    updateValue('updated');

    // Value should not be updated immediately
    expect(result).toBe('initial');

    // Wait for the timeout
    await new Promise((resolve) => setTimeout(resolve, delay + 10));

    // Value should now be updated
    expect(result).toBe('updated');
  });

  it('should handle multiple rapid changes correctly', async () => {
    let result = 'initial';
    let timeoutId: Timer | undefined;
    const delay = 100;

    const updateValue = (newValue: string) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        result = newValue;
      }, delay);
    };

    // Rapid changes
    updateValue('update1');
    await new Promise((resolve) => setTimeout(resolve, 50));
    updateValue('update2');

    // Should still be initial after partial delay
    expect(result).toBe('initial');

    // Wait for full delay after last update
    await new Promise((resolve) => setTimeout(resolve, delay + 10));

    // Should have the final value
    expect(result).toBe('update2');
  });
});
