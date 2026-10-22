import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  STUDIO_AUDIO_ACCEPT,
  validateStudioAudioFile,
} from "../../studio-media.ts";

const ROOT = new URL("../../../", import.meta.url);

test("supported audiobook formats are determined by extension, not browser MIME alone", () => {
  const cases = [
    ["chapter.mp3", "audio/mpeg", "audio/mpeg"],
    ["chapter.M4A", "", "audio/mp4"],
    ["chapter.m4a", "audio/x-m4a", "audio/mp4"],
    ["chapter.aac", "audio/aac", "audio/aac"],
    ["chapter.wav", "audio/x-wav", "audio/wav"],
    ["chapter.flac", "audio/x-flac", "audio/flac"],
    ["chapter.ogg", "audio/ogg", "audio/ogg"],
  ];
  for (const [name, reportedType, expectedType] of cases) {
    const result = validateStudioAudioFile(name, reportedType);
    assert.equal(result.valid, true, name);
    assert.equal(result.contentType, expectedType, name);
  }
});

test("unsupported formats and definite non-audio metadata fail closed", () => {
  for (const [name, type] of [
    ["chapter.wma", "audio/x-ms-wma"],
    ["chapter.aiff", "audio/aiff"],
    ["chapter.txt", ""],
    ["chapter.mp3", "text/plain"],
  ]) {
    assert.equal(validateStudioAudioFile(name, type).valid, false, name);
  }
});

test("Studio file picker and upload request preserve Safari/Files compatibility", async () => {
  const [studio, client, route] = await Promise.all([
    readFile(new URL("app/studio/[assetId]/page.tsx", ROOT), "utf8"),
    readFile(new URL("core/studio-client.ts", ROOT), "utf8"),
    readFile(new URL("app/api/studio/publications/route.ts", ROOT), "utf8"),
  ]);
  assert.equal(STUDIO_AUDIO_ACCEPT, ".mp3,.m4a,.aac,.wav,.flac,.ogg");
  assert.match(studio, /accept=\{mediaType === 'audio' \? STUDIO_AUDIO_ACCEPT/);
  assert.match(client, /validateStudioAudioFile\(file\.name, file\.type\)/);
  assert.match(client, /contentType: audio\?\.contentType/);
  assert.match(route, /validateStudioAudioFile\(payload\.fileName, contentType\)/);
  assert.match(route, /contentType = audioValidation\.contentType/);
});
