// Worker entry point. workerd requires every export from the entry module to
// be a handler, so the app (plus test-facing constants/types) lives in app.ts.
import app from "./app.js";

export default app;
