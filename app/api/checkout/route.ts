// Compatibility alias for the canonical Stripe checkout creator. This route
// no longer performs SMS, PIN, phone-derived identity, or reader authorization.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export { OPTIONS, POST } from "./listener-session/route";
