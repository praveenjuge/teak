import { createConvexRpc } from "../convexRpc";
import type { BackgroundEnv, Steps, WorkflowRun } from "../workflows/runtime";
import {
  createFakeConvex,
  type FakeHandler,
  fakeConvexEnv,
  TEST_CONVEX_SITE_URL,
} from "./fakeConvex";
import { createFakeStep } from "./fakeStep";
import { FakeBucket } from "./testsupport";

/**
 * A workflow run against a fake Convex deployment, a fake step and an
 * in-memory bucket. Pass `convex` as the run function's `deps.convex`.
 */
export const createTestRun = <Params>(
  params: Params,
  options: {
    env?: Partial<BackgroundEnv>;
    handlers?: Record<string, FakeHandler>;
    instanceId?: string;
    step?: ReturnType<typeof createFakeStep>;
    /** Wraps the fake gateway, e.g. to lose a reply after a call ran. */
    wrapFetch?: (fetcher: typeof fetch) => typeof fetch;
  } = {}
) => {
  const bucket = new FakeBucket();
  const env = {
    ...fakeConvexEnv,
    BUCKET: bucket as unknown as R2Bucket,
    ...options.env,
  } as BackgroundEnv;
  const fake = createFakeConvex({
    "workflowDispatch:complete": () => null,
    ...options.handlers,
  });
  const steps = options.step ?? createFakeStep();
  const run: WorkflowRun<Params> = {
    env,
    instanceId: options.instanceId ?? "test-instance",
    params: { ...params, convexSiteUrl: TEST_CONVEX_SITE_URL },
    step: steps.step as Steps,
  };
  return {
    bucket,
    calls: fake.calls,
    callsTo: fake.callsTo,
    convex: createConvexRpc(
      env,
      TEST_CONVEX_SITE_URL,
      options.wrapFetch ? options.wrapFetch(fake.fetcher) : fake.fetcher
    ),
    env,
    run,
    steps,
  };
};

/** How the run told Convex it ended. */
export const completionReports = (
  callsTo: ReturnType<typeof createTestRun>["callsTo"]
) =>
  callsTo("workflowDispatch:complete").map(
    (call) => call.args.status as string
  );
