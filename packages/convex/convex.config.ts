import betterAuth from "@convex-dev/better-auth/convex.config";
import migrations from "@convex-dev/migrations/convex.config";
import polar from "@convex-dev/polar/convex.config";
import r2 from "@convex-dev/r2/convex.config.js";
import ratelimiter from "@convex-dev/ratelimiter/convex.config";
import resend from "@convex-dev/resend/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import posthog from "@posthog/convex/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(betterAuth);
app.use(polar);
app.use(migrations);
app.use(workflow);
app.use(resend);
app.use(ratelimiter);
app.use(r2);
app.use(posthog);

export default app;
