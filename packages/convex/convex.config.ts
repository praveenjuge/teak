import migrations from "@convex-dev/migrations/convex.config";
import polar from "@convex-dev/polar/convex.config";
import ratelimiter from "@convex-dev/ratelimiter/convex.config";
import resend from "@convex-dev/resend/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import posthog from "@posthog/convex/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(polar);
app.use(migrations);
app.use(workflow);
app.use(resend);
app.use(ratelimiter);
app.use(posthog);

export default app;
