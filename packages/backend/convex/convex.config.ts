import { defineApp } from "convex/server";
import polar from "@convex-dev/polar/convex.config";
import migrations from "@convex-dev/migrations/convex.config";

const app = defineApp();
app.use(polar);
app.use(migrations);

export default app;