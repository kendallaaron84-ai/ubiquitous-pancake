// Compatibility alias. The canonical implementation performs Stripe signature
// verification and scopes fulfillment by checkout metadata.
export { dynamic, runtime, POST } from "./stripe/route";
