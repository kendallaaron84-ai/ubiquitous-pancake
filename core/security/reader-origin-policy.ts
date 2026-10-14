const LOCAL_ACCEPTANCE_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "koba-dev.local",
]);

function localAcceptanceEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.KOBA_LOCAL_ACCEPTANCE === "true"
  );
}

export function exactReaderOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol === "https:") return parsed.origin;
    if (
      localAcceptanceEnabled() &&
      parsed.protocol === "http:" &&
      LOCAL_ACCEPTANCE_HOSTS.has(parsed.hostname)
    ) {
      return parsed.origin;
    }
    return null;
  } catch {
    return null;
  }
}

export function exactReaderUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return exactReaderOrigin(parsed.toString()) ? parsed.toString() : null;
  } catch {
    return null;
  }
}
