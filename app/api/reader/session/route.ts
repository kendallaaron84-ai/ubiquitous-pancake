import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import {
  FirebaseAdminConfigurationError,
  getFirebaseAdminServices,
} from "@/core/firebase-admin";
import {
  LoginIdTokenError,
  verifyLoginIdToken,
} from "@/core/security/login-id-token";
import {
  establishReaderIdentity,
  ReaderAuthError,
  resolveReaderIdentitySession,
} from "@/core/security/reader-auth";
import {
  expiredReaderSessionCookieOptions,
  readReaderSessionCookie,
  READER_SESSION_COOKIE,
  readerSessionCookieOptions,
  serializeReaderSessionCookie,
} from "@/core/security/reader-session-cookie";

export const dynamic = "force-dynamic";

function correlationId(request: Request): string {
  return request.headers.get("x-request-id")?.trim() || randomUUID();
}

function configurationFailure() {
  return NextResponse.json(
    {
      success: false,
      code: "FIREBASE_ADMIN_NOT_CONFIGURED",
      error: "Reader authentication is not configured on this server.",
    },
    { status: 500 }
  );
}

function authFailure(error: LoginIdTokenError | ReaderAuthError) {
  return NextResponse.json(
    { success: false, code: error.code, error: error.message },
    { status: error.status }
  );
}

export async function POST(request: Request) {
  let payload: { idToken?: unknown };
  try {
    payload = (await request.json()) as { idToken?: unknown };
  } catch {
    return NextResponse.json(
      {
        success: false,
        code: "READER_AUTH_PAYLOAD_INVALID",
        error: "A valid JSON reader authentication payload is required.",
      },
      { status: 400 }
    );
  }

  const idToken = typeof payload.idToken === "string" ? payload.idToken : "";
  if (!idToken.trim()) {
    return NextResponse.json(
      {
        success: false,
        code: "ID_TOKEN_REQUIRED",
        error: "Identity exchange token is required.",
      },
      { status: 400 }
    );
  }
  let services;
  try {
    services = getFirebaseAdminServices();
  } catch (error: unknown) {
    console.error("Reader Firebase Admin configuration failed.", {
      code: "FIREBASE_ADMIN_NOT_CONFIGURED",
      missingVariables:
        error instanceof FirebaseAdminConfigurationError
          ? error.missingVariables
          : [],
    });
    return configurationFailure();
  }

  try {
    const claims = await verifyLoginIdToken(idToken, () => services.auth);
    const identity = await establishReaderIdentity(
      services.db,
      claims,
      correlationId(request)
    );
    const response = NextResponse.json(
      {
        success: true,
        reader: {
          uid: identity.readerUid,
          email: identity.email,
          displayName: identity.displayName,
          emailVerified: true,
        },
        expiresAt: identity.expiresAt.toISOString(),
      },
      { status: 200, headers: { "Cache-Control": "private, no-store" } }
    );
    response.cookies.set(
      READER_SESSION_COOKIE,
      serializeReaderSessionCookie(identity),
      readerSessionCookieOptions(identity.expiresAt)
    );
    return response;
  } catch (error: unknown) {
    if (error instanceof LoginIdTokenError || error instanceof ReaderAuthError) {
      return authFailure(error);
    }
    console.error("Reader session creation failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      {
        success: false,
        code: "READER_SESSION_CREATION_FAILED",
        error: "KOBA-I could not create the reader session.",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  let services;
  try {
    services = getFirebaseAdminServices();
  } catch {
    return configurationFailure();
  }

  try {
    const session = await resolveReaderIdentitySession(
      services.db,
      readReaderSessionCookie(request.headers.get("cookie"))
    );
    return NextResponse.json(
      {
        success: true,
        authenticated: true,
        reader: {
          uid: session.readerUid,
          email:
            typeof session.profile.email === "string"
              ? session.profile.email
              : null,
          displayName:
            typeof session.profile.displayName === "string"
              ? session.profile.displayName
              : null,
          emailVerified: session.profile.emailVerified === true,
        },
      },
      { status: 200, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: unknown) {
    if (error instanceof ReaderAuthError) {
      const response = authFailure(error);
      response.cookies.set(
        READER_SESSION_COOKIE,
        "",
        expiredReaderSessionCookieOptions()
      );
      return response;
    }
    console.error("Reader session validation failed.", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      {
        success: false,
        code: "READER_SESSION_VALIDATION_FAILED",
        error: "KOBA-I could not validate the reader session.",
      },
      { status: 500 }
    );
  }
}
