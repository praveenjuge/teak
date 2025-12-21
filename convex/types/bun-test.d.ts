declare module "bun:test" {
  export const describe: (...args: any[]) => void;
  export const it: (...args: any[]) => void;
  export const test: (...args: any[]) => void;
  export const expect: (...args: any[]) => any;
  export const beforeEach: (...args: any[]) => void;
  export const afterEach: (...args: any[]) => void;
  export const mock: (...args: any[]) => any;
}
