import assert from "node:assert/strict";
import test from "node:test";

import {
  TRANSCRIPTION_RATE_CENTS_PER_HOUR,
  createTranscriptionQuote,
} from "../../transcription.ts";

test("full audiobook transcription bills one dollar per rounded-up hour", () => {
  const quote = createTranscriptionQuote({
    studioTracks: [
      { id: "chapter-1", url: "https://storage.test/one.mp3", durationSeconds: 1800 },
      { id: "chapter-2", url: "https://storage.test/two.mp3", durationSeconds: 1801 },
    ],
  });

  assert.equal(TRANSCRIPTION_RATE_CENTS_PER_HOUR, 100);
  assert.equal(quote.totalDurationSeconds, 3601);
  assert.equal(quote.billableHours, 2);
  assert.equal(quote.amountCents, 200);
  assert.equal(quote.formattedAmount, "$2.00");
});

test("completed chapters are excluded from the new transcription quote", () => {
  const quote = createTranscriptionQuote({
    studioTracks: [
      { url: "https://storage.test/complete.mp3", durationSeconds: 7200, isTranscribed: true },
      { url: "https://storage.test/pending.mp3", durationSeconds: 60 },
    ],
  });

  assert.equal(quote.trackCount, 2);
  assert.equal(quote.pendingTrackCount, 1);
  assert.equal(quote.billableHours, 1);
  assert.equal(quote.amountCents, 100);
});

test("missing chapter durations are reported instead of silently undercharging", () => {
  const quote = createTranscriptionQuote({
    chapters: [{ mediaUrl: "https://storage.test/no-duration.mp3" }],
  });

  assert.equal(quote.pendingTrackCount, 1);
  assert.equal(quote.missingDurationTrackCount, 1);
  assert.equal(quote.amountCents, 0);
});
