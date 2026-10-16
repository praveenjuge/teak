import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { CRONS, type CronHandler, cronTasksOn } from "./cronSchedules";

const crons = cronJobs();

// Tasks that run on Cloudflare are the Files Worker's Cron Triggers.
for (const handler of cronTasksOn("convex") as CronHandler[]) {
  const { name, schedule } = CRONS[handler];
  crons.cron(name, schedule, internal.telemetry.crons[handler], {});
}

export default crons;
