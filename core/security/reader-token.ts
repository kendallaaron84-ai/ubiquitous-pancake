import { importPKCS8, jwtVerify, SignJWT } from "jose";

const READER_TOKEN_ALGORITHM = "RS256";
const READER_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export interface ReaderTokenInput {
  principalId: string;
  tenantId: string;
}

export interface ReaderTokenClaims extends ReaderTokenInput {
  scope: readonly ["media:read"];
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

  return new SignJWT({
      tenantId: input.tenantId,
      scope: ["media:read"],
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
    .setExpirationTime(issuedAt + READER_TOKEN_LIFETIME_SECONDS)
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
    payload.scope[0] !== "media:read"
  ) {
    throw new Error("Reader token claims are malformed.");
  }

  return {
    principalId: payload.sub,
    tenantId: payload.tenantId,
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
  for (const [name, value] of Object.entries(input)) {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`Reader token ${name} is required.`);
    }
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
