import type { OtpProvider } from "./contracts";

export type KobaAppEnvironment =
  | "development"
  | "test"
  | "production";

export interface SecurityEnvironment {
  appEnvironment: KobaAppEnvironment;
  smsProvider: OtpProvider;
  hmacSecret: string;
  identityHashSecret: string;
  identityHashVersion: number;
  jwtPrivateSigningKey: string;
  jwtPublicVerifyingKey: string;
  jwtKeyId: string;
  jwtIssuer: string;
  jwtAudience: string;
  allowedOrigins: readonly string[];
  twilioAccountSid: string | null;
  twilioAuthToken: string | null;
  twilioVerifyServiceSid: string | null;
}

export class SecurityEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityEnvironmentError";
  }
}

export function loadSecurityEnvironment(
  source: NodeJS.ProcessEnv = process.env
): SecurityEnvironment {
  const appEnvironment = parseAppEnvironment(
    source.KOBA_APP_ENV || source.NODE_ENV || "development"
  );
  const smsProvider = parseSmsProvider(
    requireValue(source, "KOBA_SMS_PROVIDER")
  );

  if (appEnvironment === "production" && smsProvider === "mock") {
    throw new SecurityEnvironmentError(
      "The mock SMS provider is forbidden in production."
    );
  }

  const twilioAccountSid = optionalValue(
    source.TWILIO_ACCOUNT_SID
  );
  const twilioAuthToken = optionalValue(
    source.TWILIO_AUTH_TOKEN
  );
  const twilioVerifyServiceSid = optionalValue(
    source.TWILIO_VERIFY_SERVICE_SID
  );

  if (
    smsProvider === "twilio_verify" &&
    (!twilioAccountSid || !twilioAuthToken || !twilioVerifyServiceSid)
  ) {
    throw new SecurityEnvironmentError(
      "Twilio Verify requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID."
    );
  }

  return {
    appEnvironment,
    smsProvider,
    hmacSecret: requireValue(source, "KOBA_HMAC_SECRET"),
    identityHashSecret: requireValue(
      source,
      "KOBA_IDENTITY_HASH_SECRET"
    ),
    identityHashVersion: parsePositiveInteger(
      requireValue(source, "KOBA_IDENTITY_HASH_VERSION"),
      "KOBA_IDENTITY_HASH_VERSION"
    ),
    jwtPrivateSigningKey: restoreMultilineSecret(
      requireValue(source, "KOBA_JWT_PRIVATE_SIGNING_KEY")
    ),
    jwtPublicVerifyingKey: restoreMultilineSecret(
      requireValue(source, "KOBA_JWT_PUBLIC_VERIFYING_KEY")
    ),
    jwtKeyId: requireValue(source, "KOBA_JWT_KEY_ID"),
    jwtIssuer: requireValue(source, "KOBA_JWT_ISSUER"),
    jwtAudience: requireValue(source, "KOBA_JWT_AUDIENCE"),
    allowedOrigins: parseAllowedOrigins(
      requireValue(source, "KOBA_ALLOWED_ORIGINS")
    ),
    twilioAccountSid,
    twilioAuthToken,
    twilioVerifyServiceSid,
  };
}

function requireValue(
  source: NodeJS.ProcessEnv,
  name: string
): string {
  const value = optionalValue(source[name]);

  if (!value) {
    throw new SecurityEnvironmentError(
      `Missing required server environment variable: ${name}`
    );
  }

  return value;
}

function optionalValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function parseAppEnvironment(value: string): KobaAppEnvironment {
  if (
    value === "development" ||
    value === "test" ||
    value === "production"
  ) {
    return value;
  }

  throw new SecurityEnvironmentError(
    "KOBA_APP_ENV must be development, test, or production."
  );
}

function parseSmsProvider(value: string): OtpProvider {
  if (value === "mock" || value === "twilio_verify") {
    return value;
  }

  throw new SecurityEnvironmentError(
    "KOBA_SMS_PROVIDER must be mock or twilio_verify."
  );
}

function parsePositiveInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new SecurityEnvironmentError(
      `${name} must be a positive integer.`
    );
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new SecurityEnvironmentError(
      `${name} must be a positive integer.`
    );
  }

  return parsed;
}

function parseAllowedOrigins(value: string): readonly string[] {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0 || origins.includes("*")) {
    throw new SecurityEnvironmentError(
      "KOBA_ALLOWED_ORIGINS must contain explicit origins and cannot contain a wildcard."
    );
  }

  return Object.freeze(
    origins.map((origin) => {
      let parsed: URL;

      try {
        parsed = new URL(origin);
      } catch {
        throw new SecurityEnvironmentError(
          `Invalid allowed origin: ${origin}`
        );
      }

      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.origin !== origin
      ) {
        throw new SecurityEnvironmentError(
          `Allowed origin must be an exact HTTP(S) origin: ${origin}`
        );
      }

      return parsed.origin;
    })
  );
}

function restoreMultilineSecret(value: string): string {
  return value.replace(/\\n/g, "\n");
}
