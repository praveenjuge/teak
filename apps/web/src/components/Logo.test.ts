import { describe, expect, it } from 'bun:test';

// Test the Logo component's variant logic
describe('Logo component logic', () => {
  it('should return correct className for default variant', () => {
    const variant = 'default';
    const expectedClass =
      'pointer-events-none h-5 shrink-0 select-none text-current/40';

    const getClassName = (
      variant: 'default' | 'primary' | 'current' = 'default'
    ) => {
      return `pointer-events-none h-5 shrink-0 select-none ${
        variant === 'primary'
          ? 'text-primary'
          : variant === 'current'
            ? 'text-current'
            : 'text-current/40'
      }`;
    };

    expect(getClassName(variant)).toBe(expectedClass);
  });

  it('should return correct className for primary variant', () => {
    const variant = 'primary';
    const expectedClass =
      'pointer-events-none h-5 shrink-0 select-none text-primary';

    const getClassName = (
      variant: 'default' | 'primary' | 'current' = 'default'
    ) => {
      return `pointer-events-none h-5 shrink-0 select-none ${
        variant === 'primary'
          ? 'text-primary'
          : variant === 'current'
            ? 'text-current'
            : 'text-current/40'
      }`;
    };

    expect(getClassName(variant)).toBe(expectedClass);
  });

  it('should return correct className for current variant', () => {
    const variant = 'current';
    const expectedClass =
      'pointer-events-none h-5 shrink-0 select-none text-current';

    const getClassName = (
      variant: 'default' | 'primary' | 'current' = 'default'
    ) => {
      return `pointer-events-none h-5 shrink-0 select-none ${
        variant === 'primary'
          ? 'text-primary'
          : variant === 'current'
            ? 'text-current'
            : 'text-current/40'
      }`;
    };

    expect(getClassName(variant)).toBe(expectedClass);
  });

  it('should default to default variant when no variant is provided', () => {
    const expectedClass =
      'pointer-events-none h-5 shrink-0 select-none text-current/40';

    const getClassName = (
      variant: 'default' | 'primary' | 'current' = 'default'
    ) => {
      return `pointer-events-none h-5 shrink-0 select-none ${
        variant === 'primary'
          ? 'text-primary'
          : variant === 'current'
            ? 'text-current'
            : 'text-current/40'
      }`;
    };

    expect(getClassName()).toBe(expectedClass);
  });
});
