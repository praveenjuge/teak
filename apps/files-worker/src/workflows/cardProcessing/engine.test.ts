import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { join } from "node:path";
import type { WorkflowRpcResponse } from "@teak/files-protocol";
import { createTestHarness } from "wrangler";

// Card processing on Cloudflare's real Workflows engine (Miniflare, through
// Wrangler's test harness), not the fake step runner the other tests use. It
// proves what only the engine decides: that step retry configs are accepted
// and retried, that a NonRetryableError ends a step at once, and that every
// run, skipped or failed, reports back to Convex. A local server stands in for
// Convex's workflow RPC endpoint and records each call.

const WORKER_DIR = join(import.meta.dir, "../../..");
const CARD_ID = "jd7f2kz9m8w6y1v3h4n5q0r8s2t6u4x1";
const LOAD_CARD = "card/processingRpc:getCardForProcessing";
const MARK_IN_PROGRESS = "card/processingRpc:markStagesInProgress";
const COMPLETE = "workflowDispatch:complete";

interface RpcCall {
  args: Record<string, unknown>;
  guard?: { cardId: string; rev: number };
  kind: string;
  name: string;
}

const calls: RpcCall[] = [];
let answer: (call: RpcCall) => Response = () => ok(null);

function ok(value: unknown): Response {
  return Response.json({ ok: true, value } satisfies WorkflowRpcResponse);
}

const refuse = (code: string): Response =>
  Response.json({
    error: { code, message: code },
    ok: false,
  } satisfies WorkflowRpcResponse);

const convex = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const call = (await request.json()) as RpcCall;
    calls.push(call);
    return answer(call);
  },
});
const convexSiteUrl = `http://127.0.0.1:${convex.port}`;

const server = createTestHarness({
  root: WORKER_DIR,
  workers: [
    {
      config: {
        name: "teak-files-engine-test",
        main: "src/index.ts",
        compatibility_date: "2026-08-01",
        compatibility_flags: ["nodejs_compat"],
        workflows: [
          {
            name: "teak-engine-test-card-processing",
            binding: "CARD_PROCESSING",
            class_name: "CardProcessingWorkflow",
          },
        ],
        vars: {
          CONVEX_SITE_URLS: convexSiteUrl,
          WORKFLOW_RPC_ROOT_SECRET: "teak-engine-test-root-secret",
        },
      },
    },
  ],
});

const loadedCard = (processingRev: number) => ({
  card: {
    _creationTime: 1,
    _id: CARD_ID,
    content: "A note about bread",
    processingRev,
    type: "text",
    userId: "user_1",
  },
  keyPrefix: "test/",
});

const callsTo = (name: string) => calls.filter((call) => call.name === name);

let instances = 0;

/** Starts a run at revision 1 and waits for it to settle in `status`. */
const process = async (status: "complete" | "errored") => {
  const worker = server.getWorker();
  await using workflow = await worker.introspectWorkflow("CARD_PROCESSING");
  await workflow.modifyAll(async (modifier) => {
    await modifier.disableRetryDelays();
  });
  const env = (await worker.getEnv()) as { CARD_PROCESSING: Workflow };
  instances += 1;
  await env.CARD_PROCESSING.create({
    id: `engine-test-${instances}`,
    params: { cardId: CARD_ID, convexSiteUrl, rev: 1 },
  });
  const [instance] = await workflow.get();
  if (!instance) {
    throw new Error("the Workflow instance never started");
  }
  await instance.waitForStatus(status);
  const settled =
    status === "complete"
      ? await instance.getOutput()
      : await instance.getError();
  return JSON.parse(JSON.stringify(settled)) as Record<string, unknown>;
};

beforeAll(async () => {
  await server.listen();
}, 120_000);

afterAll(async () => {
  await server.close();
  await convex.stop(true);
});

beforeEach(() => {
  calls.length = 0;
});

describe("card processing on the Workflows engine", () => {
  test("skips a card whose revision moved on and reports the run complete", async () => {
    answer = (call) => (call.name === LOAD_CARD ? ok(loadedCard(2)) : ok(null));

    expect(await process("complete")).toEqual({
      mode: "skipped",
      reason: "superseded",
    });
    expect(callsTo(MARK_IN_PROGRESS)).toHaveLength(0);
    expect(callsTo(COMPLETE).map((call) => call.args.status)).toEqual([
      "complete",
    ]);
  }, 60_000);

  test("stops at the first write Convex refuses as stale, without retrying it", async () => {
    answer = (call) => {
      if (call.name === LOAD_CARD) {
        return ok(loadedCard(1));
      }
      return call.guard ? refuse("stale_processing_revision") : ok(null);
    };

    expect(await process("complete")).toEqual({
      mode: "skipped",
      reason: "superseded",
    });
    expect(callsTo(MARK_IN_PROGRESS)).toEqual([
      {
        args: { cardId: CARD_ID, stages: ["classify"] },
        guard: { cardId: CARD_ID, rev: 1 },
        kind: "mutation",
        name: MARK_IN_PROGRESS,
      },
    ]);
    expect(callsTo(COMPLETE).map((call) => call.args.status)).toEqual([
      "complete",
    ]);
  }, 60_000);

  test("retries loading the card while Convex is unavailable", async () => {
    let outages = 2;
    answer = (call) => {
      if (call.name !== LOAD_CARD) {
        return ok(null);
      }
      if (outages > 0) {
        outages -= 1;
        return new Response("unavailable", { status: 503 });
      }
      return ok(loadedCard(2));
    };

    expect(await process("complete")).toEqual({
      mode: "skipped",
      reason: "superseded",
    });
    expect(callsTo(LOAD_CARD)).toHaveLength(3);
  }, 60_000);

  test("reports a run Convex refuses as errored, without retrying it", async () => {
    answer = (call) =>
      call.name === LOAD_CARD
        ? new Response("forbidden", { status: 403 })
        : ok(null);

    await process("errored");

    expect(callsTo(LOAD_CARD)).toHaveLength(1);
    const reports = callsTo(COMPLETE);
    expect(reports.map((call) => call.args.status)).toEqual(["errored"]);
    expect(String(reports[0]?.args.error)).toContain(
      `convex_rpc_refused:${LOAD_CARD}:403`
    );
  }, 60_000);
});
