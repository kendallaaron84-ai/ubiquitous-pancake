import { requireNexusAuthorContext } from "./author-context";
import { NexusRouteError } from "./http";

export async function requireNexusOwnerContext() {
  const context = await requireNexusAuthorContext();
  const owners = new Set((process.env.KOBA_OWNER_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  if (!owners.has(context.authorEmail.trim().toLowerCase())) throw new NexusRouteError(403, "Owner access is required.");
  return context;
}
