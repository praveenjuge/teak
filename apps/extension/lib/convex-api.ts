// Thin wrapper to import the generated Convex API without pulling in server-only code.
// Importing directly from the generated client avoids bundling backend auth code
// that relies on Node globals (e.g., process.env) in the browser extension.
export { api } from "../../../backend/convex/_generated/api";
