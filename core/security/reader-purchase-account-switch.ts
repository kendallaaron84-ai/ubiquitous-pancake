import { safeReaderContinuation } from "./reader-paid-launch.ts";

export const READER_ACCOUNT_SWITCH_ERROR =
  "READER_ACCOUNT_SWITCH_FAILED" as const;

export async function switchReaderPurchaseAccount(input: {
  claimPath: string;
  logoutReaderSession: () => Promise<{ ok: boolean }>;
  logoutFirebaseIdentity: () => Promise<void>;
  navigate: (path: string) => void;
}): Promise<void> {
  const continuation = safeReaderContinuation(input.claimPath);
  if (!continuation || !continuation.startsWith("/reader/claim?session_id=")) {
    throw new Error(READER_ACCOUNT_SWITCH_ERROR);
  }

  const response = await input.logoutReaderSession();
  if (!response.ok) {
    throw new Error(READER_ACCOUNT_SWITCH_ERROR);
  }

  await input.logoutFirebaseIdentity();
  input.navigate(
    `/reader/signin?next=${encodeURIComponent(continuation)}`
  );
}
