// Convex app config: the static-hosting component serves the Expo web build (dist/) from the deployment's .convex.site URL.
// Its catch-all route is registered in http.ts after our own routes, so /telegram, /creao and auth keep their URLs.
import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

const app = defineApp();
app.use(staticHosting);

export default app;
