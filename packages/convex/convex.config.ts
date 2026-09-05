import betterAuth from "@convex-dev/better-auth/convex.config";
import polar from "@convex-dev/polar/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import resend from "@convex-dev/resend/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import apiKeys from "@vllnt/convex-api-keys/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(betterAuth);
app.use(polar);
app.use(workflow);
app.use(resend);
app.use(rateLimiter, { name: "rateLimiterV2" });
app.use(apiKeys);

export default app;
