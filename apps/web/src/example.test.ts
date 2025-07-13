import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

describe('Bun Test Examples', () => {
  beforeAll(() => {
    console.log('Setting up tests...');
  });

  afterAll(() => {
    console.log('Cleaning up tests...');
  });

  it('should handle basic assertions', () => {
    expect(1 + 1).toBe(2);
    expect('hello').toContain('lo');
    expect([1, 2, 3]).toHaveLength(3);
  });

  it('should handle async operations', async () => {
    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const start = Date.now();
    await delay(50);
    const end = Date.now();

    expect(end - start).toBeGreaterThanOrEqual(50);
  });

  it('should handle object and array matching', () => {
    const user = { id: 1, name: 'John', email: 'john@test.com' };

    expect(user).toEqual({
      id: 1,
      name: 'John',
      email: 'john@test.com',
    });

    expect(user).toHaveProperty('name', 'John');

    const numbers = [1, 2, 3, 4, 5];
    expect(numbers).toContain(3);
    expect(numbers).toEqual(expect.arrayContaining([1, 3, 5]));
  });

  it('should handle function mocking', () => {
    // Simple mock function implementation
    let callCount = 0;
    let lastArgs: any[] = [];

    const mockFn = (...args: any[]) => {
      callCount++;
      lastArgs = args;
    };

    mockFn('arg1', 'arg2');

    expect(callCount).toBe(1);
    expect(lastArgs).toEqual(['arg1', 'arg2']);
  });

  it('should handle error testing', () => {
    const throwError = () => {
      throw new Error('Something went wrong');
    };

    expect(throwError).toThrow('Something went wrong');
    expect(throwError).toThrow(Error);
  });

  it('should handle Promise rejections', async () => {
    const rejectPromise = () => Promise.reject(new Error('Async error'));

    await expect(rejectPromise()).rejects.toThrow('Async error');
  });
});
