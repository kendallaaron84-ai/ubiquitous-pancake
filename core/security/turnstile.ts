const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TOKEN_MAX_LENGTH = 2_048;
const VERIFY_TIMEOUT_MS = 5_000;

export const TURNSTILE_ERROR_CODES = {
  tokenRequired: "HUMAN_VERIFICATION_REQUIRED",
  failed: "HUMAN_VERIFICATION_FAILED",
  notConfigured: "HUMAN_VERIFICATION_NOT_CONFIGURED",
  unavailable: "HUMAN_VERIFICATION_UNAVAILABLE",
} as const;

type TurnstileErrorCode =
  (typeof TURNSTILE_ERROR_CODES)[keyof typeof TURNSTILE_ERROR_CODES];

export class TurnstileVerificationError extends Error {
  readonly status: 400 | 403 | 503;
  readonly code: TurnstileErrorCode;

  constructor(status: 400 | 403 | 503, code: TurnstileErrorCode, message: string) {
    super(message);
    this.name = "TurnstileVerificationError";
    this.status = status;
    this.code = code;
  }
}

interface SiteverifyResponse {
  success?: boolean;
  hostname?: string;
  action?: string;
  cdata?: string;
}

export async function verifyFreePublicationHuman(input: {
  token: string;
  assetId: string;
  source?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const token = input.token.trim();
  if (!token || token.length > TOKEN_MAX_LENGTH) {
    throw new TurnstileVerificationError(
      400,
      TURNSTILE_ERROR_CODES.tokenRequired,
      "Complete the human verification before opening this publication."
    );
  }

  const source = input.source || process.env;
  const secret = source.TURNSTILE_SECRET_KEY?.trim();
  const expectedHostname = source.TURNSTILE_EXPECTED_HOSTNAME?.trim().toLowerCase();
  if (!secret || !expectedHostname) {
    throw new TurnstileVerificationError(
      503,
      TURNSTILE_ERROR_CODES.notConfigured,
      "Human verification is not configured on this server."
    );
  }

  const body = new URLSearchParams({
    secret,
    response: token,
    idempotency_key: crypto.randomUUID(),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  let payload: SiteverifyResponse;
  try {
    const response = await (input.fetchImpl || fetch)(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("SITEVERIFY_HTTP_FAILURE");
    payload = (await response.json()) as SiteverifyResponse;
  } catch {
    throw new TurnstileVerificationError(
      503,
      TURNSTILE_ERROR_CODES.unavailable,
      "Human verification is temporarily unavailable."
    );
  } finally {
    clearTimeout(timeout);
  }

  if (
    payload.success !== true ||
    payload.hostname?.toLowerCase() !== expectedHostname ||
    payload.action !== "free_publication" ||
    payload.cdata !== input.assetId
  ) {
    throw new TurnstileVerificationError(
      403,
      TURNSTILE_ERROR_CODES.failed,
      "Human verification could not be confirmed. Please try again."
    );
  }
}
