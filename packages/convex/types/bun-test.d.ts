declare module "bun:test" {
  export const describe: (...args: any[]) => void;
  type TestFn = ((...args: any[]) => void) & {
    each: (cases: readonly any[]) => (...args: any[]) => void;
  };
  export const it: TestFn;
  export const test: TestFn;
  export const expect: (...args: any[]) => any;
  export const beforeEach: (...args: any[]) => void;
  export const beforeAll: (...args: any[]) => void;
  export const afterEach: (...args: any[]) => void;
  export const afterAll: (...args: any[]) => void;
  export const mock: ((...args: any[]) => any) & {
    module: (...args: any[]) => void;
  };
}
