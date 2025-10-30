import { defineApp } from "convex/server";
import polar from "@convex-dev/polar/convex.config";
import migrations from "@convex-dev/migrations/convex.config";
import workflow from "@convex-dev/workflow/convex.config";

const app = defineApp();
app.use(polar);
app.use(migrations);
app.use(workflow);

export default app;
