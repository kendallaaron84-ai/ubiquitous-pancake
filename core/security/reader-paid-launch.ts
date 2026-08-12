const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,159}$/;
const CHECKOUT_SESSION_PATTERN = /^cs_[A-Za-z0-9_]{12,}$/;
const CONTINUATION_ORIGIN = "https://reader.koba-i.invalid";

export const READER_PAID_LAUNCH_ERROR_CODES = {
  requestInvalid: "READER_PAID_LAUNCH_REQUEST_INVALID",
  unavailable: "READER_PAID_LAUNCH_UNAVAILABLE",
} as const;

export type ReaderMediaHandoffHandler = (request: Request) => Promise<Response>;

export function paidReaderLaunchPath(assetId: string): string | null {
  const normalized = assetId.trim();
  return ASSET_ID_PATTERN.test(normalized)
    ? `/reader/open?assetId=${encodeURIComponent(normalized)}`
    : null;
}

export function paidReaderRecoveryPath(assetId: string): string | null {
  const normalized = assetId.trim();
  return ASSET_ID_PATTERN.test(normalized)
    ? `/reader/purchases/recover?assetId=${encodeURIComponent(normalized)}`
    : null;
}

export function safeReaderContinuation(value?: string): string | null {
  if (!value) return null;

  try {
    const parsed = new URL(value, CONTINUATION_ORIGIN);
    if (
      parsed.origin === CONTINUATION_ORIGIN &&
      parsed.pathname === "/reader/claim" &&
      !parsed.hash &&
      [...parsed.searchParams.keys()].every((key) => key === "session_id") &&
      parsed.searchParams.getAll("session_id").length === 1 &&
      CHECKOUT_SESSION_PATTERN.test(parsed.searchParams.get("session_id") || "")
    ) {
      return `/reader/claim?session_id=${encodeURIComponent(
        parsed.searchParams.get("session_id")!
      )}`;
    }
    if (
      parsed.origin !== CONTINUATION_ORIGIN ||
      parsed.hash ||
      [...parsed.searchParams.keys()].some((key) => key !== "assetId")
    ) {
      return null;
    }
    if (parsed.pathname === "/reader/open") {
      return paidReaderLaunchPath(parsed.searchParams.get("assetId") || "");
    }
    if (parsed.pathname === "/reader/purchases/recover") {
      return paidReaderRecoveryPath(parsed.searchParams.get("assetId") || "");
    }
    return null;
  } catch {
    return null;
  }
}

function failure(status: number, code: string, error: string): Response {
  return Response.json({ success: false, code, error }, { status });
}

export function createPaidReaderLaunchHandler(
  createHandoff: ReaderMediaHandoffHandler
) {
  return async (request: Request): Promise<Response> => {
    const requestUrl = new URL(request.url);
    const launchPath =
      [...requestUrl.searchParams.keys()].every((key) => key === "assetId") &&
      requestUrl.searchParams.getAll("assetId").length === 1
        ? paidReaderLaunchPath(requestUrl.searchParams.get("assetId") || "")
        : null;

    if (!launchPath) {
      return failure(
        400,
        READER_PAID_LAUNCH_ERROR_CODES.requestInvalid,
        "A valid publication asset is required."
      );
    }

    const assetId = new URL(launchPath, CONTINUATION_ORIGIN).searchParams.get(
      "assetId"
    )!;
    const handoffRequest = new Request(
      new URL("/api/reader/media/handoff", requestUrl.origin),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: request.headers.get("cookie") || "",
        },
        body: JSON.stringify({ assetId }),
      }
    );
    const handoffResponse = await createHandoff(handoffRequest);
    const payload = (await handoffResponse.json().catch(() => null)) as {
      code?: string;
      error?: string;
      launchUrl?: string;
    } | null;

    if (handoffResponse.status === 401) {
      const signIn = new URL("/reader/signin", requestUrl.origin);
      signIn.searchParams.set("next", launchPath);
      return Response.redirect(signIn, 303);
    }

    if (!handoffResponse.ok) {
      return failure(
        handoffResponse.status,
        payload?.code || READER_PAID_LAUNCH_ERROR_CODES.unavailable,
        payload?.error || "KOBA-I could not open this publication."
      );
    }

    try {
      const launchUrl = new URL(payload?.launchUrl || "");
      if (launchUrl.protocol !== "https:") throw new Error("invalid launch URL");
      return Response.redirect(launchUrl, 303);
    } catch {
      return failure(
        502,
        READER_PAID_LAUNCH_ERROR_CODES.unavailable,
        "The publication destination is unavailable."
      );
    }
  };
}
