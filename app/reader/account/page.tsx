import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ReaderAccount } from "@/components/reader/ReaderAccount";
import {
  FirebaseAdminConfigurationError,
  getFirebaseAdminServices,
} from "@/core/firebase-admin";
import {
  ReaderAuthError,
  resolveReaderIdentitySession,
} from "@/core/security/reader-auth";
import { listReaderBookshelf } from "@/core/security/reader-bookshelf";
import {
  parseReaderSessionCookie,
  READER_SESSION_COOKIE,
} from "@/core/security/reader-session-cookie";

export const dynamic = "force-dynamic";

export default async function ReaderAccountPage() {
  try {
    const services = getFirebaseAdminServices();
    const cookieStore = await cookies();
    const reader = await resolveReaderIdentitySession(
      services.db,
      parseReaderSessionCookie(cookieStore.get(READER_SESSION_COOKIE)?.value)
    );
    const publications = await listReaderBookshelf(services.db, reader.readerUid);

    return (
      <ReaderAccount
        reader={{
          email:
            typeof reader.profile.email === "string"
              ? reader.profile.email
              : null,
          displayName:
            typeof reader.profile.displayName === "string"
              ? reader.profile.displayName
              : null,
        }}
        publications={publications}
      />
    );
  } catch (error: unknown) {
    if (error instanceof ReaderAuthError) {
      redirect("/reader/signin?next=/reader/account");
    }
    if (error instanceof FirebaseAdminConfigurationError) {
      return (
        <p role="alert" className="text-center text-red-200">
          Reader access is not configured on this server.
        </p>
      );
    }
    throw error;
  }
}
