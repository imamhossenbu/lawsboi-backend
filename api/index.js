// Vercel's entry: every request is handled by the Express app, built to dist/ by `npm run build` first.
// (Locally and on a plain server, src/index.ts listens instead.) Scheduled work comes from /cron/tick.
import { createApp } from "../dist/app.js";

export default createApp();
