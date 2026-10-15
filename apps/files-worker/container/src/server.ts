// Teak media renderer: the Files Worker's Cloudflare Container.
//
// The Worker streams a source file (≤ 100 MiB) as the raw POST body; the
// renderer spools it to WORK_DIR/<job-id>/input, runs ffprobe/ffmpeg or
// poppler under hard limits (see exec.ts and args.ts), answers, and deletes
// the job directory. It never makes outbound requests. One job at a time:
// a second POST while a job runs gets 503 busy.
//
//   GET  /health                  {"ok":true,"protocol":1,"busy":bool}
//   POST /probe                   facts only                        (15 s)
//   POST /video?frameMax&scrubFrames&scrubMax    frame [+ scrub]    (60 s)
//   POST /audio?peaks=45,200&whisper=auto|never|always  [whisper]   (120 s)
//   POST /pdf/page?max            page                              (30 s)
//   POST /pdf/text?maxPages&maxChars             text               (30 s)
//   POST /animation/palette?frames               palette only       (30 s)
//
// Success is 200 with an `x-teak-manifest` JSON header ({protocol, facts,
// parts, …job fields}) and the parts' bytes concatenated as the body.
// Errors are {"error","message"} JSON: 400 bad_request, 404 not_found,
// 413 too_large, 415 unsupported, 422 timeout, 503 busy, 500 internal.
//
// Environment:
//   PORT                    listen port (default 8080)
//   WORK_DIR                spool directory (default /work)
//   RENDERER_TIMEOUT_SCALE  multiplies every job's wall clock (default 1);
//                           tests use a tiny value to exercise 422 timeout

import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { errorResponse, JobError, timedOut, tooLarge } from "./errors";
import { audioJob } from "./jobs/audio";
import type { JobContext } from "./jobs/context";
import { pdfPageJob, pdfTextJob } from "./jobs/pdf";
import { probeJob } from "./jobs/probe";
import { animationPaletteJob, videoJob } from "./jobs/video";
import { type JobResult, jobResponse, PROTOCOL } from "./manifest";
import {
  animationParams,
  audioParams,
  pdfPageParams,
  pdfTextParams,
  videoParams,
} from "./params";

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const SPOOL_TIMEOUT_MS = 120_000;

const PORT = Number(process.env.PORT ?? 8080);
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

const ROUTES: Record<string, Route> = {
  "/probe": { wallClockMs: 15_000, prepare: () => probeJob },
  "/video": {
    wallClockMs: 60_000,
    prepare: (query) => {
      const params = videoParams(query);
      return (ctx) => videoJob(ctx, params);
    },
  },
  "/audio": {
    wallClockMs: 120_000,
    prepare: (query) => {
      const params = audioParams(query);
      return (ctx) => audioJob(ctx, params);
    },
  },
  "/pdf/page": {
    wallClockMs: 30_000,
    prepare: (query) => {
      const params = pdfPageParams(query);
      return (ctx) => pdfPageJob(ctx, params);
    },
  },
  "/pdf/text": {
    wallClockMs: 30_000,
    prepare: (query) => {
      const params = pdfTextParams(query);
      return (ctx) => pdfTextJob(ctx, params);
    },
  },
  "/animation/palette": {
    wallClockMs: 30_000,
    prepare: (query) => {
      const params = animationParams(query);
      return (ctx) => animationPaletteJob(ctx, params);
    },
  },
};

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
      while (true) {
        const { done, value } = await readWithin(reader.read(), deadline);
        if (done) {
          return;
        }
        total += value.byteLength;
        if (total > MAX_INPUT_BYTES) {
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
    const deadline = Date.now() + route.wallClockMs * TIMEOUT_SCALE;
    return jobResponse(await job({ dir, input, deadline }));
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
    return Response.json({ ok: true, protocol: PROTOCOL, busy });
  }
  const route = ROUTES[url.pathname];
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
    if (declared > MAX_INPUT_BYTES) {
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
  maxRequestBodySize: MAX_INPUT_BYTES * 2,
  fetch: handle,
});

console.log(`renderer listening on ${server.port}`);
