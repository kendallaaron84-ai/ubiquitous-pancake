import type { DecodedIdToken } from "firebase-admin/auth";

import {
  FirebaseAdminConfigurationError,
  getFirebaseAdminAuth,
} from "../firebase-admin.ts";

export const LOGIN_ID_TOKEN_ERROR_CODES = {
  adminNotConfigured: "FIREBASE_ADMIN_NOT_CONFIGURED",
  missingToken: "ID_TOKEN_REQUIRED",
  invalidToken: "INVALID_ID_TOKEN",
} as const;

export class LoginIdTokenError extends Error {
  readonly status: 400 | 401 | 500;
  readonly code: (typeof LOGIN_ID_TOKEN_ERROR_CODES)[keyof typeof LOGIN_ID_TOKEN_ERROR_CODES];
  readonly cause?: unknown;

  constructor(
    status: 400 | 401 | 500,
    code: (typeof LOGIN_ID_TOKEN_ERROR_CODES)[keyof typeof LOGIN_ID_TOKEN_ERROR_CODES],
    message: string,
    cause?: unknown
  ) {
    super(message);
    this.name = "LoginIdTokenError";
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

interface AdminAuthVerifier {
  verifyIdToken(idToken: string): Promise<DecodedIdToken>;
}

type AdminAuthResolver = () => AdminAuthVerifier;

export async function verifyLoginIdToken(
  idToken: string,
  resolveAdminAuth: AdminAuthResolver = getFirebaseAdminAuth
): Promise<DecodedIdToken> {
  if (!idToken.trim()) {
    throw new LoginIdTokenError(
      400,
      LOGIN_ID_TOKEN_ERROR_CODES.missingToken,
      "Identity exchange token is required."
    );
  }

  let auth: AdminAuthVerifier;
  try {
    auth = resolveAdminAuth();
    if (!auth || typeof auth.verifyIdToken !== "function") {
      throw new FirebaseAdminConfigurationError(
        "Firebase Admin Auth did not initialize correctly."
      );
    }
  } catch (error: unknown) {
    throw new LoginIdTokenError(
      500,
      LOGIN_ID_TOKEN_ERROR_CODES.adminNotConfigured,
      "Firebase Admin authentication is not configured on this server.",
      error
    );
  }

  try {
    return await auth.verifyIdToken(idToken);
  } catch (error: unknown) {
    throw new LoginIdTokenError(
      401,
      LOGIN_ID_TOKEN_ERROR_CODES.invalidToken,
      "Invalid identity token.",
      error
    );
  }
}
