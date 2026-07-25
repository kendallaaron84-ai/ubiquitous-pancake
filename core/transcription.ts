export const TRANSCRIPTION_RATE_CENTS_PER_HOUR = 100;

export interface TranscriptionQuote {
  totalDurationSeconds: number;
  totalDurationHours: number;
  billableHours: number;
  amountCents: number;
  formattedAmount: string;
  trackCount: number;
  pendingTrackCount: number;
  missingDurationTrackCount: number;
}

export function createTranscriptionQuote(product: Record<string, unknown>): TranscriptionQuote {
  const tracks = Array.isArray(product.studioTracks)
    ? product.studioTracks as Array<Record<string, unknown>>
    : Array.isArray(product.chapters)
      ? product.chapters as Array<Record<string, unknown>>
      : [];
  const playable = tracks.filter((track) => Boolean(
    track.url || track.audioUrl || track.mediaUrl || track.securedPlaybackUrl || track.streamUrl
  ));
  const pending = playable.filter((track) => track.isTranscribed !== true);
  const durations = pending.map(trackDurationSeconds);
  const missingDurationTrackCount = durations.filter((duration) => duration <= 0).length;
  const totalDurationSeconds = Math.round(durations.reduce((sum, duration) => sum + duration, 0));
  const totalDurationHours = totalDurationSeconds / 3600;
  const billableHours = totalDurationSeconds > 0 ? Math.ceil(totalDurationHours) : 0;
  const amountCents = billableHours * TRANSCRIPTION_RATE_CENTS_PER_HOUR;
  return {
    totalDurationSeconds,
    totalDurationHours,
    billableHours,
    amountCents,
    formattedAmount: `$${(amountCents / 100).toFixed(2)}`,
    trackCount: playable.length,
    pendingTrackCount: pending.length,
    missingDurationTrackCount,
  };
}

function trackDurationSeconds(track: Record<string, unknown>): number {
  const value = Number(
    track.durationSeconds ?? track.duration ??
    (track.metadata && typeof track.metadata === "object"
      ? (track.metadata as Record<string, unknown>).durationSeconds
      : 0)
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}
