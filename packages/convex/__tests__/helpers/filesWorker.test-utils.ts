// Loads the Files Worker into a convex-test suite, so a test can drive its
// real ops and workflows against the test database. Paths are resolved at
// runtime to keep Cloudflare's global types out of backend typechecking.
// A suite that uses it mocks `@resvg/resvg-wasm/index_bg.wasm` (vi.mock is
// hoisted per test file), which Node cannot load.

import type { convexTest } from "convex-test";

type TestConvex = ReturnType<typeof convexTest>;

const workerFile = (path: string) =>
  new URL(`../../../../apps/files-worker/src/${path}`, import.meta.url)
    .pathname;

class FixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(_expectedLength: number) {
    super();
  }
}

const runtime = globalThis as Record<string, unknown>;
runtime.FixedLengthStream ??= FixedLengthStream;
runtime.caches ??= {
  default: {
    delete: () => Promise.resolve(false),
    match: () => Promise.resolve(undefined),
    put: () => Promise.resolve(),
  },
};

export const loadFilesWorker = async () => {
  const [index, support, filesOps, fakeStep, accountDeletion, imports] =
    await Promise.all([
      import(workerFile("index.ts")),
      import(workerFile("test/testsupport.ts")),
      import(workerFile("workflows/filesOps.ts")),
      import(workerFile("test/fakeStep.ts")),
      import(workerFile("workflows/accountDeletion.ts")),
      import(workerFile("workflows/import.ts")),
    ]);
  return {
    callFilesOp: filesOps.callFilesOp,
    createFakeStep: fakeStep.createFakeStep,
    drainStorageBatch: accountDeletion.drainStorageBatch,
    FakeBucket: support.FakeBucket,
    runAccountDeletion: accountDeletion.runAccountDeletion,
    runImport: imports.runImport,
    withObjectGates: support.withObjectGates,
    worker: index.default,
  };
};

type Call = (ref: unknown, args: unknown) => Promise<unknown>;

/** The test deployment as the Worker's Convex client: calls run in-process. */
export const convexForWorker = (t: TestConvex) => ({
  action: t.action as Call,
  mutation: t.mutation as Call,
  query: t.query as Call,
});
