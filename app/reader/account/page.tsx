import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ReaderAccount } from "@/components/reader/ReaderAccount";
import {
  FirebaseAdminConfigurationError,
  getFirebaseAdminServices,
} from "@/core/firebase-admin";
import { ReaderAuthError } from "@/core/security/reader-auth";
import { loadReaderBookshelfPageData } from "@/core/security/reader-bookshelf-loader";
import {
  parseReaderSessionCookie,
  READER_SESSION_COOKIE,
} from "@/core/security/reader-session-cookie";

export const dynamic = "force-dynamic";

export default async function ReaderAccountPage() {
  try {
    const services = getFirebaseAdminServices();
    const cookieStore = await cookies();
    const pageData = await loadReaderBookshelfPageData(
      services.db,
      parseReaderSessionCookie(cookieStore.get(READER_SESSION_COOKIE)?.value)
    );

    return (
      <ReaderAccount
        reader={{
          email: pageData.reader.email,
          displayName: pageData.reader.displayName,
        }}
        publications={pageData.publications}
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
