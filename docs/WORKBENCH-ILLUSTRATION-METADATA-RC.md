# Workbench Illustration Metadata — Offline Release-Candidate Evidence

## Lineage and scope

- Branch: `codex/workbench-image-metadata`
- Approved baseline: `4caea13411c1cc2218848c2775e81aeffd0da330`
- Scope: Alt Text and Caption editing for existing inline protected illustrations only.
- Out of scope: image upload architecture, asset replacement, OCR, pixel editing, AI generation, schemas, reader authorization, and production deployment.

The editor accepts only figures containing `img[data-koba-storage-path]`. It never calls upload, preview-ticket creation, deletion, or asset replacement operations from a metadata action.

## User-visible contract

- **Preview** applies plain-text metadata to the currently selected editor DOM only. It does not update `bookData` and cannot enter a Save Draft payload.
- **Accept** applies normalized metadata to the local unsaved chapter draft. **Save Draft** remains the only persistence boundary.
- **Cancel** restores the last accepted metadata, discards preview-only edits, closes the metadata editor, and returns keyboard focus to the figure.
- **Revert** restores the metadata present when the selected figure's metadata editor was opened. The restored values remain an unsaved local draft until Save Draft.
- Alt Text is required and limited to 500 characters. Caption is optional and limited to 2,000 characters.
- Empty captions remove only direct `figcaption` children. Multiple direct captions normalize to one.
- Enter or Space on a focused protected figure opens the metadata editor and moves focus to Alt Text.

## Integrity and lifecycle controls

- Metadata is inserted through DOM `textContent`; markup entered by an author remains inert text.
- The helper verifies that `src` and `data-koba-storage-path` remain unchanged after every edit and every trusted restoration.
- Figure placement remains unchanged; caption edits occur only inside the selected figure.
- Editor-only focus and selection attributes are removed before serialization.
- Signed preview URLs are scrubbed before draft serialization under the existing protected-image contract.
- A selected figure must still be a descendant of the active chapter editor and must retain the selected canonical storage path before any action proceeds.
- Accept, Revert, and new-image insertion capture an editor-local `{ figureIndex, storagePath, source }` locator before canonical HTML updates. If React replaces the contentEditable DOM, the selected figure is re-resolved by index plus path and its already-authorized preview source is restored DOM-only. The locator is never serialized.
- The index disambiguates repeated uses of the same protected path; a mismatched index/path fails closed instead of selecting another figure.
- Chapter switch, editor input, Save Draft, selection change, and unmount discard active preview-only state. Preview never silently becomes accepted or persisted.
- Choosing an Add Image Here position restores and clears any active preview before the file picker opens; insertion repeats that check before serializing the chapter, so metadata previewed on another figure cannot be promoted into the draft.
- Historical metadata that exceeds the new 500/2,000 author-input limits is retained as an immutable trusted snapshot. Cancel, Revert, Save cleanup, selection cleanup, chapter cleanup, and unmount restore that snapshot exactly without treating legacy text as new input. New author-entered values remain capped.
- Save Draft serializes only previously accepted chapter HTML. Reload/re-entry obtains a new authorized preview URL from the existing server path.
- An intentionally empty Alt Text value is not supported by the current canonical sanitizer; this change fails closed and requires nonempty Alt Text rather than changing that broader contract.

## Validation evidence

### Passed

`node --test core/security/__tests__/workbench-illustration-metadata.test.mjs core/security/__tests__/protected-chapter-images.test.mjs core/security/__tests__/studio-image.test.mjs core/security/__tests__/studio-publication-access.test.mjs core/security/__tests__/studio-upload-lifecycle.test.mjs`

- 36 tests passed, 0 failed.
- Covers plain-text/XSS behavior; Preview/Accept/Cancel/Revert; preview exclusion from Save Draft; save/refresh/reader signing; direct caption normalization; exact protected source/path preservation; placement/order; metadata limits; upload security; SVG rejection; canonical publication ownership; and authenticated preview routing.
- Includes over-limit legacy restoration for Preview to Cancel/Revert/Save/chapter switch/selection change/unmount, Preview-to-new-image isolation, same-path source-mismatch failure, duplicate-path index disambiguation, and authorized-preview rebinding after a simulated React DOM replacement.

### Environment-limited gates

- The complete security test glob discovered 149 tests: 125 passed and 24 could not load because this isolated worktree has no installed `firebase-admin`/`jose` dependencies. The failures were dependency-resolution failures, not assertion failures.
- A TypeScript check performed with a matching external dependency tree reported existing unrelated errors (including missing Sentry types and pre-existing implicit `any` sites); it reported no error in the changed Workbench or metadata-helper files.
- A clean package hydration/build was stopped after dependency linking stalled in the OneDrive worktree. No lockfile or package metadata was changed.
- This repository has no established Playwright Workbench dependency or production-component browser harness. The Node functional/security test is not represented as browser E2E. Live browser Save/refresh/reopen and physical assistive-technology/device validation remain required before release.

## Remaining acceptance gaps

- Actual Next.js Workbench browser run: Windows Edge/Chrome, macOS Safari/Chrome.
- Keyboard and screen-reader pass: NVDA and VoiceOver.
- Mobile visual/reload confirmation where Workbench authoring is supported.
- Independent AntiG review of the exact commit and manifest.

The original independent review of the pre-correction candidate was NO-GO because it identified legacy restoration and detached-figure defects. Both paths now have explicit regressions, but the amended candidate remains **NO-GO pending independent re-review and a genuine mounted-component/browser test**.

## Rollback

Revert the single metadata-editor commit. No schema, stored-asset, route, or migration rollback is required. Existing publication HTML remains compatible because this change uses the existing `alt`/`figure`/`figcaption` sanitized HTML contract.
