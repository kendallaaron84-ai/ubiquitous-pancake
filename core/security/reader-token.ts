import { importPKCS8, jwtVerify, SignJWT } from "jose";

const READER_TOKEN_ALGORITHM = "RS256";
const READER_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const ANONYMOUS_FREE_TOKEN_LIFETIME_SECONDS = 72 * 60 * 60;

export interface ReaderTokenInput {
  principalId: string;
  tenantId: string;
  principalType?: "firebase_uid" | "anonymous_free";
  assetId?: string;
  origin?: string;
}

export interface ReaderTokenClaims {
  principalId: string;
  tenantId: string;
  scope: readonly ["media:read"];
  principalType: "firebase_uid" | "anonymous_free" | "legacy";
  assetId?: string;
  origin?: string;
}

export async function signReaderToken(
  input: ReaderTokenInput,
  source: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): Promise<string> {
  validateInput(input);
  const configuration = resolveReaderTokenConfiguration(source);
  const signingKey = await importPKCS8(
    configuration.privateKey,
    READER_TOKEN_ALGORITHM
  );
  const issuedAt = Math.floor(now.getTime() / 1000);
  const lifetime = input.principalType === "anonymous_free"
    ? ANONYMOUS_FREE_TOKEN_LIFETIME_SECONDS
    : READER_TOKEN_LIFETIME_SECONDS;

  return new SignJWT({
      tenantId: input.tenantId,
      scope: ["media:read"],
      ...(input.principalType ? { principalType: input.principalType } : {}),
      ...(input.assetId ? { assetId: input.assetId } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
  })
    .setProtectedHeader({
      alg: READER_TOKEN_ALGORITHM,
      kid: configuration.keyId,
      typ: "JWT",
    })
    .setSubject(input.principalId)
    .setIssuer(configuration.issuer)
    .setAudience(configuration.audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + lifetime)
    .sign(signingKey);
}

export async function verifyReaderToken(
  token: string,
  source: NodeJS.ProcessEnv = process.env
): Promise<ReaderTokenClaims> {
  const configuration = resolveReaderTokenConfiguration(source);
  const verifyingKey = await importPublicKey(configuration.publicKey);
  const { payload, protectedHeader } = await jwtVerify(token, verifyingKey, {
    algorithms: [READER_TOKEN_ALGORITHM],
    issuer: configuration.issuer,
    audience: configuration.audience,
  });

  if (protectedHeader.kid !== configuration.keyId) {
    throw new Error("Reader token key identifier is invalid.");
  }

  if (
    typeof payload.sub !== "string" ||
    typeof payload.tenantId !== "string" ||
    !Array.isArray(payload.scope) ||
    payload.scope.length !== 1 ||
    payload.scope[0] !== "media:read" ||
    (payload.principalType !== undefined &&
      payload.principalType !== "firebase_uid" &&
      payload.principalType !== "anonymous_free")
  ) {
    throw new Error("Reader token claims are malformed.");
  }
  if (payload.principalType === "anonymous_free") {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/.test(String(payload.assetId || ""))) {
      throw new Error("Reader token anonymous asset claim is malformed.");
    }
    try {
      const parsed = new URL(String(payload.origin || ""));
      if (parsed.protocol !== "https:" || parsed.origin !== payload.origin) throw new Error();
    } catch {
      throw new Error("Reader token anonymous origin claim is malformed.");
    }
  } else if (payload.assetId !== undefined || payload.origin !== undefined) {
    throw new Error("Reader token resource claims are malformed.");
  }

  return {
    principalId: payload.sub,
    tenantId: payload.tenantId,
    principalType: payload.principalType === "firebase_uid"
      ? "firebase_uid"
      : payload.principalType === "anonymous_free"
        ? "anonymous_free"
        : "legacy",
    ...(typeof payload.assetId === "string" ? { assetId: payload.assetId } : {}),
    ...(typeof payload.origin === "string" ? { origin: payload.origin } : {}),
    scope: ["media:read"],
  };
}

async function importPublicKey(publicKey: string) {
  const { importSPKI } = await import("jose");
  return importSPKI(publicKey, READER_TOKEN_ALGORITHM);
}

function resolveReaderTokenConfiguration(source: NodeJS.ProcessEnv) {
  return {
    privateKey: restoreMultiline(requireValue(source, "KOBA_JWT_PRIVATE_SIGNING_KEY")),
    publicKey: restoreMultiline(requireValue(source, "KOBA_JWT_PUBLIC_VERIFYING_KEY")),
    keyId: requireValue(source, "KOBA_JWT_KEY_ID"),
    issuer: requireValue(source, "KOBA_JWT_ISSUER"),
    audience: requireValue(source, "KOBA_JWT_AUDIENCE"),
  };
}

function validateInput(input: ReaderTokenInput): void {
  for (const [name, value] of Object.entries({
    principalId: input.principalId,
    tenantId: input.tenantId,
  })) {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`Reader token ${name} is required.`);
    }
  }
  if (
    input.principalType !== undefined &&
    input.principalType !== "firebase_uid" &&
    input.principalType !== "anonymous_free"
  ) {
    throw new TypeError("Reader token principalType is invalid.");
  }
  if (input.principalType === "anonymous_free") {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/.test(input.assetId || "")) {
      throw new TypeError("Reader token assetId is required for anonymous free access.");
    }
    try {
      const parsed = new URL(input.origin || "");
      if (parsed.protocol !== "https:" || parsed.origin !== input.origin) throw new Error();
    } catch {
      throw new TypeError("Reader token HTTPS origin is required for anonymous free access.");
    }
  } else if (input.assetId !== undefined || input.origin !== undefined) {
    throw new TypeError("Reader token resource claims are reserved for anonymous free access.");
  }
}

function requireValue(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`Missing reader security configuration: ${name}`);
  return value;
}

function restoreMultiline(value: string): string {
  return value.replace(/\\n/g, "\n");
}
