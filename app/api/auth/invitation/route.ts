import { getFirebaseAdminServices } from "@/core/firebase-admin";
import { establishAuthorInvitation, resolveAuthorInvitation } from "@/core/security/author-invitation";
import { createAuthorInvitationHandlers } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handlers = createAuthorInvitationHandlers({
  resolve: (token) => {
    const services = getFirebaseAdminServices();
    return resolveAuthorInvitation(services.db, token);
  },
  establish: (input) => {
    const services = getFirebaseAdminServices();
    return establishAuthorInvitation(services.db, services.auth, input);
  },
});

export const GET = handlers.GET;
export const POST = handlers.POST;
