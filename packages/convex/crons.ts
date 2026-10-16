import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { CRONS, type CronHandler } from "./cronSchedules";

const crons = cronJobs();

for (const handler of Object.keys(CRONS) as CronHandler[]) {
  const { name, schedule } = CRONS[handler];
  crons.cron(name, schedule, internal.telemetry.crons[handler], {});
}

export default crons;
