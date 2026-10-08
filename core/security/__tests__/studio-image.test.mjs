import assert from "node:assert/strict";
import test from "node:test";

import { validateStudioImageFile } from "../../studio-image.ts";

test("approved raster formats are accepted with canonical content types", () => {
  for (const [fileName, mimeType, expected] of [
    ["photo.jpg", "image/jpeg", "image/jpeg"],
    ["photo.JPEG", "", "image/jpeg"],
    ["overlay.png", "image/png", "image/png"],
    ["animation.gif", "image/gif", "image/gif"],
  ]) {
    assert.deepEqual(validateStudioImageFile(fileName, mimeType), {
      valid: true,
      contentType: expected,
    });
  }
});

test("SVG and disguised or unsupported formats are rejected", () => {
  for (const [fileName, mimeType] of [
    ["illustration.svg", "image/svg+xml"],
    ["illustration.svg", ""],
    ["payload.svg", "image/png"],
    ["payload.png", "image/svg+xml"],
    ["photo.webp", "image/webp"],
  ]) {
    assert.equal(validateStudioImageFile(fileName, mimeType).valid, false);
  }
});
