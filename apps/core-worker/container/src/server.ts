import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { errorResponse, JobError, timedOut, tooLarge } from "./errors";
import { audioJob } from "./jobs/audio";
import type { JobContext } from "./jobs/context";
import { pdfPageJob, pdfTextJob } from "./jobs/pdf";
import { probeJob } from "./jobs/probe";
import { animationPaletteJob, videoJob } from "./jobs/video";
import { type JobResult, jobResponse } from "./manifest";
import {
  animationParams,
  audioParams,
  pdfPageParams,
  pdfTextParams,
  videoParams,
} from "./params";
import {
  RENDERER_JOBS,
  RENDERER_MAX_INPUT_BYTES,
  RENDERER_PORT,
  RENDERER_PROTOCOL,
  type RendererJob,
} from "./protocol";

const SPOOL_TIMEOUT_MS = 120_000;

const PORT = Number(process.env.PORT ?? RENDERER_PORT);
const WORK_DIR = process.env.WORK_DIR ?? "/work";

function timeoutScale(raw: string | undefined): number {
  const value = Number(raw ?? 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
const TIMEOUT_SCALE = timeoutScale(process.env.RENDERER_TIMEOUT_SCALE);

interface Route {
  prepare: (query: URLSearchParams) => (ctx: JobContext) => Promise<JobResult>;
  wallClockMs: number;
}

const PREPARE: Record<RendererJob, Route["prepare"]> = {
  animationPalette: (query) => {
    const params = animationParams(query);
    return (ctx) => animationPaletteJob(ctx, params);
  },
  audio: (query) => {
    const params = audioParams(query);
    return (ctx) => audioJob(ctx, params);
  },
  pdfPage: (query) => {
    const params = pdfPageParams(query);
    return (ctx) => pdfPageJob(ctx, params);
  },
  pdfText: (query) => {
    const params = pdfTextParams(query);
    return (ctx) => pdfTextJob(ctx, params);
  },
  probe: () => probeJob,
  video: (query) => {
    const params = videoParams(query);
    return (ctx) => videoJob(ctx, params);
  },
};

const ROUTES = new Map<string, Route>(
  (Object.keys(RENDERER_JOBS) as RendererJob[]).map((job) => [
    RENDERER_JOBS[job].path,
    { prepare: PREPARE[job], wallClockMs: RENDERER_JOBS[job].wallClockMs },
  ])
);

let busy = false;

async function readWithin<T>(read: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timedOut()), deadline - Date.now());
  });
  try {
    return await Promise.race([read, expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function spool(request: Request, path: string): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try {
    if (!request.body) {
      return;
    }
    const reader = request.body.getReader();
    const deadline = Date.now() + SPOOL_TIMEOUT_MS;
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await readWithin(reader.read(), deadline);
        if (done) {
          return;
        }
        total += value.byteLength;
        if (total > RENDERER_MAX_INPUT_BYTES) {
          throw tooLarge();
        }
        await file.write(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
  } finally {
    await file.close();
  }
}

async function runJob(
  request: Request,
  route: Route,
  job: (ctx: JobContext) => Promise<JobResult>
): Promise<Response> {
  const dir = join(WORK_DIR, randomUUID());
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const input = join(dir, "input");
    await spool(request, input);
    const deadlineEpochMs = Date.now() + route.wallClockMs * TIMEOUT_SCALE;
    return jobResponse(await job({ dir, input, deadlineEpochMs }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function handle(
  request: Request,
  server: Bun.Server<undefined>
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true, protocol: RENDERER_PROTOCOL, busy });
  }
  const route = ROUTES.get(url.pathname);
  if (!(route && request.method === "POST")) {
    return errorResponse(new JobError("not_found", "Not found"));
  }
  try {
    const job = route.prepare(url.searchParams);
    if (busy) {
      return errorResponse(
        new JobError("busy", "Another job is running on this instance")
      );
    }
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > RENDERER_MAX_INPUT_BYTES) {
      throw tooLarge();
    }
    busy = true;
    try {
      // Jobs keep their own clocks; don't let idle connections cut them off.
      server.timeout(request, 0);
      return await runJob(request, route, job);
    } finally {
      busy = false;
    }
  } catch (error) {
    if (error instanceof JobError) {
      return errorResponse(error);
    }
    console.error("renderer job failed", error);
    return errorResponse(
      new JobError("internal", "The renderer hit an unexpected error")
    );
  }
}

const server = Bun.serve({
  port: PORT,
  // The spool enforces the real cap; this only stops Bun refusing first.
  maxRequestBodySize: RENDERER_MAX_INPUT_BYTES * 2,
  fetch: handle,
});

console.log(`renderer listening on ${server.port}`);
