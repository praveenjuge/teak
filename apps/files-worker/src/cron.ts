import type { BackgroundEnv } from "./workflows/runtime";

/**
 * Runs the background task each Cron Trigger (wrangler.jsonc
 * `triggers.crons`) stands for.
 */
export const handleScheduled = (
  controller: ScheduledController,
  _env: BackgroundEnv,
  _ctx: ExecutionContext
): Promise<void> => {
  switch (controller.cron) {
    default:
      console.error("[cron] no task", { cron: controller.cron });
  }
  return Promise.resolve();
};
