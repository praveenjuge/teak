import { describe, expect, it } from 'bun:test';
import { cn } from './utils';

describe('cn utility function', () => {
  it('should merge class names correctly', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('should handle conditional classes', () => {
    expect(cn('base-class', 'conditional-class')).toBe(
      'base-class conditional-class'
    );
  });

  it('should handle false conditional classes', () => {
    expect(cn('base-class', false)).toBe('base-class');
  });

  it('should merge conflicting Tailwind classes correctly', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('should handle empty inputs', () => {
    expect(cn()).toBe('');
  });

  it('should handle undefined and null values', () => {
    expect(cn('class1', undefined, 'class2', null)).toBe('class1 class2');
  });
});
