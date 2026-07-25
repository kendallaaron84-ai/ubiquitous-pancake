export interface CorsOptions {
  methods?: readonly string[];
  allowedHeaders?: readonly string[];
  maxAgeSeconds?: number;
}

const DEFAULT_METHODS = ["GET", "POST", "OPTIONS"] as const;
const DEFAULT_ALLOWED_HEADERS = [
  "Authorization",
  "Content-Type",
] as const;

export function isAllowedOrigin(
  origin: string | null,
  allowedOrigins: readonly string[]
): boolean {
  return Boolean(origin && allowedOrigins.includes(origin));
}

export function createCorsHeaders(
  origin: string | null,
  allowedOrigins: readonly string[],
  options: CorsOptions = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": (
      options.methods || DEFAULT_METHODS
    ).join(", "),
    "Access-Control-Allow-Headers": (
      options.allowedHeaders || DEFAULT_ALLOWED_HEADERS
    ).join(", "),
  };

  if (isAllowedOrigin(origin, allowedOrigins)) {
    headers["Access-Control-Allow-Origin"] = origin as string;
  }

  if (options.maxAgeSeconds !== undefined) {
    if (
      !Number.isSafeInteger(options.maxAgeSeconds) ||
      options.maxAgeSeconds < 0
    ) {
      throw new TypeError(
        "CORS maxAgeSeconds must be a non-negative integer."
      );
    }

    headers["Access-Control-Max-Age"] = String(
      options.maxAgeSeconds
    );
  }

  return headers;
}
