import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyProtectedIllustrationMetadata,
  captureProtectedIllustrationLocator,
  normalizeIllustrationMetadata,
  rebindProtectedIllustration,
  readProtectedIllustrationMetadata,
  restoreProtectedIllustrationSnapshot,
} from "../../studio-illustration-metadata.ts";
import { attachProtectedChapterImageUrls } from "../protected-chapter-images.ts";
import {
  assertTenantBoundStoragePath,
  buildWorkbenchDraftPatch,
} from "../studio-publication-access.ts";

const ROOT = new URL("../../../", import.meta.url);
const ASSET_ID = "ebk_metadata";
const STUDIO_KEY = "studio_author";
const STORAGE_PATH = `studio/${ASSET_ID}/${STUDIO_KEY}/illustration/page-one.png`;
const PREVIEW_URL = "https://signed.example/preview.png?token=temporary";

function escapeText(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}

class FakeCaption {
  constructor(figure, text = "") {
    this.figure = figure;
    this.textContent = text;
  }

  remove() {
    this.figure.captions = this.figure.captions.filter((caption) => caption !== this);
  }
}

class FakeImage {
  constructor(attributes) {
    this.attributes = new Map(Object.entries(attributes));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

class FakeFigure {
  constructor({ altText = "Original description", caption = "Original caption", source = PREVIEW_URL, storagePath = STORAGE_PATH } = {}) {
    this.image = new FakeImage({
      src: source,
      "data-koba-storage-path": storagePath,
      alt: altText,
      loading: "lazy",
    });
    this.captions = caption ? [new FakeCaption(this, caption)] : [];
    this.ownerDocument = {
      createElement: (tag) => {
        assert.equal(tag, "figcaption");
        return new FakeCaption(this);
      },
    };
  }

  querySelector(selector) {
    if (selector === "img[data-koba-storage-path]") return this.image;
    if (selector === ":scope > figcaption") return this.captions[0] || null;
    return null;
  }

  querySelectorAll(selector) {
    return selector === ":scope > figcaption" ? [...this.captions] : [];
  }

  appendChild(child) {
    this.captions.push(child);
    return child;
  }

  toHtml() {
    const attributes = [...this.image.attributes.entries()]
      .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
      .join("");
    const caption = this.captions.map((item) => `<figcaption>${escapeText(item.textContent)}</figcaption>`).join("");
    return `<figure class="koba-illustration"><img${attributes}>${caption}</figure>`;
  }
}

class FakeEditor {
  constructor(figures = []) {
    this.figures = figures;
  }

  contains(figure) {
    return this.figures.includes(figure);
  }

  querySelectorAll(selector) {
    return selector === "figure.koba-illustration" ? [...this.figures] : [];
  }
}

test("preview changes only plain-text metadata and preserves protected image identity", () => {
  const figure = new FakeFigure();
  const before = readProtectedIllustrationMetadata(figure);
  const protectedPathBytes = figure.image.getAttribute("data-koba-storage-path");
  const previewSourceBytes = figure.image.getAttribute("src");
  const prefix = "<p data-proof=\"unchanged\">Paragraph 1</p>";
  const suffix = "<p data-proof=\"unchanged\">Paragraph 2</p>";
  const after = applyProtectedIllustrationMetadata(figure, {
    altText: "A writer revising a manuscript",
    caption: "Draft <img src=x onerror=alert(1)> review",
  });

  assert.equal(after.storagePath, before.storagePath);
  assert.equal(after.source, before.source);
  assert.equal(figure.image.getAttribute("data-koba-storage-path"), protectedPathBytes);
  assert.equal(figure.image.getAttribute("src"), previewSourceBytes);
  assert.equal(after.altText, "A writer revising a manuscript");
  assert.equal(after.caption, "Draft <img src=x onerror=alert(1)> review");
  assert.match(figure.toHtml(), /Draft &lt;img src=x onerror=alert\(1\)&gt; review/);
  assert.doesNotMatch(figure.toHtml(), /<img src=x onerror/);
  const chapter = `${prefix}${figure.toHtml()}${suffix}`;
  assert.ok(chapter.startsWith(prefix));
  assert.ok(chapter.endsWith(suffix));
  assert.match(chapter, new RegExp(`src="${escapeAttribute(PREVIEW_URL).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(chapter, new RegExp(`data-koba-storage-path="${STORAGE_PATH}"`));
});

test("preview-only metadata never enters the Save Draft payload", () => {
  const figure = new FakeFigure();
  const acceptedHtml = `<p>Before</p>${figure.toHtml()}<p>After</p>`;
  applyProtectedIllustrationMetadata(figure, { altText: "Preview only", caption: "Not accepted" });
  assert.match(figure.toHtml(), /Preview only/);

  const saved = buildWorkbenchDraftPatch({
    assetId: ASSET_ID,
    studioKey: STUDIO_KEY,
    layoutMode: "reflowable",
    chapters: [{ id: "chapter_one", title: "Chapter One", textContent: acceptedHtml }],
    guardrails: {},
  }).chapters[0].textContent;
  assert.match(saved, /Original description/);
  assert.match(saved, /Original caption/);
  assert.doesNotMatch(saved, /Preview only|Not accepted/);
});

test("cancel and revert restore accepted and original metadata without changing source or placement", () => {
  const figure = new FakeFigure();
  const original = readProtectedIllustrationMetadata(figure);
  const before = `<p>Paragraph 1</p>${figure.toHtml()}<p>Paragraph 2</p>`;

  applyProtectedIllustrationMetadata(figure, { altText: "Preview alt", caption: "Preview caption" });
  applyProtectedIllustrationMetadata(figure, original);
  assert.deepEqual(readProtectedIllustrationMetadata(figure), original);

  applyProtectedIllustrationMetadata(figure, { altText: "Accepted alt", caption: "Accepted caption" });
  applyProtectedIllustrationMetadata(figure, original);
  const reverted = `<p>Paragraph 1</p>${figure.toHtml()}<p>Paragraph 2</p>`;
  assert.equal(reverted, before);
  assert.ok(reverted.indexOf("Paragraph 1") < reverted.indexOf(STORAGE_PATH));
  assert.ok(reverted.indexOf(STORAGE_PATH) < reverted.indexOf("Paragraph 2"));
});

test("empty captions remove figcaption while preserving the protected image", () => {
  const figure = new FakeFigure();
  applyProtectedIllustrationMetadata(figure, { altText: "Accessible description", caption: "" });
  assert.equal(figure.captions.length, 0);
  assert.match(figure.toHtml(), new RegExp(escapeText(STORAGE_PATH)));
  assert.doesNotMatch(figure.toHtml(), /figcaption/);
});

test("editing normalizes duplicate direct figcaptions to one plain-text caption", () => {
  const figure = new FakeFigure();
  figure.captions.push(new FakeCaption(figure, "Duplicate caption"));
  applyProtectedIllustrationMetadata(figure, { altText: "Accessible description", caption: "One caption" });
  assert.equal(figure.captions.length, 1);
  assert.equal(figure.captions[0].textContent, "One caption");
});

test("metadata limits fail closed and control characters are removed", () => {
  assert.deepEqual(
    normalizeIllustrationMetadata({ altText: "  Safe\u0000 description  ", caption: " Caption\u0007 " }),
    { altText: "Safe description", caption: "Caption" }
  );
  assert.throws(
    () => normalizeIllustrationMetadata({ altText: "  ", caption: "" }),
    /Alt text is required/
  );
  assert.throws(
    () => normalizeIllustrationMetadata({ altText: "a".repeat(501), caption: "" }),
    /500 characters or fewer/
  );
  assert.throws(
    () => normalizeIllustrationMetadata({ altText: "Description", caption: "c".repeat(2_001) }),
    /2,000 characters or fewer/
  );
});

test("trusted legacy metadata restores exactly without applying new-author limits", () => {
  const legacyAlt = `Legacy ${"a".repeat(700)}`;
  const legacyCaption = `Legacy ${"c".repeat(2_500)}`;
  const figure = new FakeFigure({ altText: legacyAlt, caption: legacyCaption });
  const trusted = readProtectedIllustrationMetadata(figure);

  applyProtectedIllustrationMetadata(figure, { altText: "Short preview", caption: "Preview caption" });
  const restored = restoreProtectedIllustrationSnapshot(figure, trusted);

  assert.equal(restored.altText, legacyAlt);
  assert.equal(restored.caption, legacyCaption);
  assert.deepEqual(restored.directCaptions, [legacyCaption]);
  assert.equal(restored.source, PREVIEW_URL);
  assert.equal(restored.storagePath, STORAGE_PATH);
});

test("trusted restoration fails closed when a same-path preview source changes unexpectedly", () => {
  const figure = new FakeFigure();
  const trusted = readProtectedIllustrationMetadata(figure);
  applyProtectedIllustrationMetadata(figure, { altText: "Preview only", caption: "Preview only" });
  figure.image.setAttribute("src", "https://unexpected.example/replaced-preview");

  assert.throws(
    () => restoreProtectedIllustrationSnapshot(figure, trusted),
    /no longer matches its trusted metadata snapshot/
  );
  assert.equal(figure.image.getAttribute("alt"), "Preview only");
  assert.equal(figure.image.getAttribute("src"), "https://unexpected.example/replaced-preview");
});

test("Preview cleanup preserves over-limit legacy values for Cancel, Revert, Save, chapter switch, selection change, and unmount", () => {
  const legacyAlt = "a".repeat(501);
  const legacyCaption = "c".repeat(2_001);
  for (const transition of ["Cancel", "Revert", "Save", "chapter switch", "selection change", "unmount"]) {
    const figure = new FakeFigure({ altText: legacyAlt, caption: legacyCaption });
    const trusted = readProtectedIllustrationMetadata(figure);
    applyProtectedIllustrationMetadata(figure, { altText: `${transition} preview`, caption: "Preview only" });
    restoreProtectedIllustrationSnapshot(figure, trusted);
    const restored = readProtectedIllustrationMetadata(figure);
    assert.equal(restored.altText, legacyAlt, transition);
    assert.equal(restored.caption, legacyCaption, transition);
    assert.doesNotMatch(figure.toHtml(), /Preview only/, transition);
  }

  const savedFigure = new FakeFigure({ altText: legacyAlt, caption: legacyCaption });
  const trusted = readProtectedIllustrationMetadata(savedFigure);
  applyProtectedIllustrationMetadata(savedFigure, { altText: "Preview", caption: "Preview only" });
  restoreProtectedIllustrationSnapshot(savedFigure, trusted);
  const saved = buildWorkbenchDraftPatch({
    assetId: ASSET_ID,
    studioKey: STUDIO_KEY,
    layoutMode: "reflowable",
    chapters: [{ id: "chapter_one", title: "Chapter One", textContent: savedFigure.toHtml() }],
    guardrails: {},
  }).chapters[0].textContent;
  assert.match(saved, new RegExp(`alt="${legacyAlt}"`));
  assert.match(saved, new RegExp(`<figcaption>${legacyCaption}</figcaption>`));
  assert.doesNotMatch(saved, /Preview only/);
});

test("editor-local locators rebind React-replaced figures and restore their existing authorized previews", () => {
  const first = new FakeFigure({ source: "https://signed.example/first" });
  const selected = new FakeFigure({ source: PREVIEW_URL });
  const editor = new FakeEditor([first, selected]);
  const firstLocator = captureProtectedIllustrationLocator(editor, first);
  const locator = captureProtectedIllustrationLocator(editor, selected);
  assert.deepEqual(firstLocator, { figureIndex: 0, storagePath: STORAGE_PATH, source: "https://signed.example/first" });
  assert.deepEqual(locator, { figureIndex: 1, storagePath: STORAGE_PATH, source: PREVIEW_URL });

  const replacementFirst = new FakeFigure({ source: "" });
  const replacementSelected = new FakeFigure({ source: "" });
  editor.figures = [replacementFirst, replacementSelected];
  const reboundFirst = rebindProtectedIllustration(editor, firstLocator);
  const rebound = rebindProtectedIllustration(editor, locator);

  assert.equal(reboundFirst, replacementFirst);
  assert.equal(rebound, replacementSelected);
  assert.notEqual(rebound, replacementFirst);
  assert.equal(replacementSelected.image.getAttribute("src"), PREVIEW_URL);
  assert.equal(replacementFirst.image.getAttribute("src"), "https://signed.example/first");
  assert.equal(replacementSelected.image.getAttribute("data-koba-storage-path"), STORAGE_PATH);

  const unexpectedSource = new FakeFigure({ source: "https://unexpected.example/other" });
  editor.figures = [replacementFirst, unexpectedSource];
  assert.equal(rebindProtectedIllustration(editor, locator), null);
  assert.equal(unexpectedSource.image.getAttribute("src"), "https://unexpected.example/other");
});

test("starting a new insertion restores preview-only metadata before another figure can be serialized", () => {
  const first = new FakeFigure({ altText: "Accepted first", caption: "Accepted caption" });
  const accepted = readProtectedIllustrationMetadata(first);
  applyProtectedIllustrationMetadata(first, {
    altText: "Preview must not persist",
    caption: "Preview-only caption",
  });

  restoreProtectedIllustrationSnapshot(first, accepted);
  const second = new FakeFigure({
    altText: "Second illustration",
    caption: "",
    source: "https://signed.example/second",
    storagePath: `studio/${ASSET_ID}/${STUDIO_KEY}/illustration/page-two.png`,
  });
  const serialized = `<p>Before</p>${first.toHtml()}${second.toHtml()}<p>After</p>`;

  assert.match(serialized, /Accepted first/);
  assert.match(serialized, /Accepted caption/);
  assert.doesNotMatch(serialized, /Preview must not persist|Preview-only caption/);
  assert.ok(serialized.indexOf(STORAGE_PATH) < serialized.indexOf("page-two.png"));
});

test("accept, Save Draft, refresh, and reader signing preserve figure, caption, order, and canonical identity", async () => {
  const figure = new FakeFigure({ caption: "" });
  applyProtectedIllustrationMetadata(figure, {
    altText: "Kendall recording narration",
    caption: "Recording the audiobook edition.",
  });
  const chapterHtml = `<p>Paragraph 1</p>${figure.toHtml()}<p>Paragraph 2</p>`;

  const patch = buildWorkbenchDraftPatch({
    assetId: ASSET_ID,
    studioKey: STUDIO_KEY,
    layoutMode: "reflowable",
    chapters: [{ id: "chapter_one", title: "Chapter One", textContent: chapterHtml }],
    guardrails: {},
  });
  const persisted = patch.chapters[0].textContent;
  assert.match(persisted, /src=""/);
  assert.doesNotMatch(persisted, /token=temporary|signed\.example/);
  assert.match(persisted, /alt="Kendall recording narration"/);
  assert.match(persisted, /<figcaption>Recording the audiobook edition\.<\/figcaption>/);
  assert.ok(persisted.indexOf("Paragraph 1") < persisted.indexOf(STORAGE_PATH));
  assert.ok(persisted.indexOf(STORAGE_PATH) < persisted.indexOf("Paragraph 2"));

  const rendered = await attachProtectedChapterImageUrls(
    persisted,
    (path) => assertTenantBoundStoragePath(path, ASSET_ID, STUDIO_KEY),
    async () => "https://signed.example/fresh-reader-url"
  );
  assert.match(rendered, /https:\/\/signed\.example\/fresh-reader-url/);
  assert.match(rendered, /data-koba-storage-path=/);
  assert.match(rendered, /<figure class="koba-illustration">/);
  assert.match(rendered, /<figcaption>Recording the audiobook edition\.<\/figcaption>/);
});

test("Workbench exposes separate Preview, Accept, Revert, and Cancel controls through the existing save contract", async () => {
  const source = await readFile(new URL("app/workbench/[assetId]/page.tsx", ROOT), "utf8");
  assert.match(source, /aria-label="Illustration details"/);
  assert.match(source, /> Preview<\/button>/);
  assert.match(source, /> Accept<\/button>/);
  assert.match(source, /> Revert<\/button>/);
  assert.match(source, /> Cancel<\/button>/);
  assert.match(source, /applyProtectedIllustrationMetadata\(figure, illustrationMetadata\.draft\)/);
  assert.match(source, /updateActiveChapterHtml\(serializedEditorHtml\(\)\)/);
  assert.match(source, /save_workbench_draft/);
  const previewBody = source.slice(
    source.indexOf("const previewIllustrationMetadata"),
    source.indexOf("function queueIllustrationHtmlCommit")
  );
  assert.doesNotMatch(previewBody, /updateActiveChapterHtml|saveStudioProduct/);
  const acceptBody = source.slice(
    source.indexOf("const acceptIllustrationMetadata"),
    source.indexOf("const cancelIllustrationMetadata")
  );
  assert.match(acceptBody, /queueIllustrationHtmlCommit\(figure\)/);
  assert.match(source, /restorePendingIllustrationPreview\(\)/);
  assert.match(source, /restoreProtectedIllustrationSnapshot\(figure, metadata\.accepted\)/);
  assert.match(source, /rebindProtectedIllustration\(editor, locator\)/);
  assert.match(source, /pendingRebind\.figures\.forEach\(\(locator\) => rebindProtectedIllustration\(editor, locator\)\)/);
  assert.match(source, /if \(!clearIllustrationSelection\(\)\)/);
  const insertionBody = source.slice(
    source.indexOf("const insertImageAtSelectedPosition"),
    source.indexOf("const activeSelectedIllustration")
  );
  const chooseSlotBody = source.slice(
    source.indexOf("const chooseImageForSlot"),
    source.indexOf("useEffect(() =>", source.indexOf("const chooseImageForSlot"))
  );
  assert.match(chooseSlotBody, /if \(!clearIllustrationSelection\(\)\)/);
  assert.ok(
    chooseSlotBody.indexOf("clearIllustrationSelection") < chooseSlotBody.indexOf("imageInputRef.current?.click"),
    "Preview cleanup must precede opening the image picker."
  );
  assert.match(insertionBody, /if \(!clearIllustrationSelection\(\)\)/);
  assert.ok(
    insertionBody.indexOf("clearIllustrationSelection") < insertionBody.indexOf('document.createElement("figure")'),
    "Defensive preview cleanup must precede insertion serialization."
  );
  assert.match(insertionBody, /queueIllustrationHtmlCommit\(figure\)/);
  assert.doesNotMatch(insertionBody, /updateActiveChapterHtml\(serializedEditorHtml\(\)\)/);
  assert.match(source, /editorRef\.current\?\.contains\(figure\)/);
  assert.match(source, /figure\.dataset\.kobaEditorFigure = "true"/);
  assert.match(source, /selectIllustration\(figure, true\)/);
  assert.match(source, /illustrationAltTextInputRef\.current\?\.focus\(\)/);
  const metadataActions = source.slice(
    source.indexOf("const previewIllustrationMetadata"),
    source.indexOf("const handleIllustrationUpload")
  );
  assert.doesNotMatch(metadataActions, /uploadStudioFile|loadStudioMediaPreview|delete|replaceImage/);
  assert.doesNotMatch(source, /OCR|generateIllustration|replaceImagePixels/);
});

test("Workbench memoizes chapter innerHTML across metadata-only renders", async () => {
  const source = await readFile(new URL("app/workbench/[assetId]/page.tsx", ROOT), "utf8");

  assert.match(source, /import React, \{[^}]*\buseMemo\b[^}]*\} from "react"/);
  assert.match(
    source,
    /const activeChapterSourceHtml = bookData\?\.chapters\?\.\[activeChapterIndex\]\?\.textContent[\s\S]*?const activeChapterEditorMarkup = useMemo\(/
  );
  assert.match(
    source,
    /useMemo\(\s*\(\) => \(\{ __html: editorHtml\(activeChapterSourceHtml\) \}\),\s*\[activeChapterSourceHtml\]\s*\)/
  );
  assert.match(source, /dangerouslySetInnerHTML=\{activeChapterEditorMarkup\}/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML=\{\{\s*__html:/);

  const inputBindings = source.slice(
    source.indexOf('aria-label="Illustration details"'),
    source.indexOf('dangerouslySetInnerHTML={activeChapterEditorMarkup}')
  );
  assert.match(inputBindings, /draft: \{ \.\.\.illustrationMetadata\.draft, altText: event\.target\.value \}/);
  assert.match(inputBindings, /draft: \{ \.\.\.illustrationMetadata\.draft, caption: event\.target\.value \}/);

  const previewToCancel = source.slice(
    source.indexOf("const previewIllustrationMetadata"),
    source.indexOf("const revertIllustrationMetadata")
  );
  assert.match(previewToCancel, /applyProtectedIllustrationMetadata\(figure, illustrationMetadata\.draft\)/);
  assert.match(previewToCancel, /restoreProtectedIllustrationSnapshot\(figure, illustrationMetadata\.accepted\)/);
  assert.match(previewToCancel, /clearIllustrationSelection\(false\)/);
});

test("Workbench re-resolves an insertion position after blur and rejects stale cross-chapter uploads", async () => {
  const source = await readFile(new URL("app/workbench/[assetId]/page.tsx", ROOT), "utf8");
  const chooseSlotBody = source.slice(
    source.indexOf("const chooseImageForSlot"),
    source.indexOf("useEffect(() =>", source.indexOf("const chooseImageForSlot"))
  );
  const insertionBody = source.slice(
    source.indexOf("const insertImageAtSelectedPosition"),
    source.indexOf("const activeSelectedIllustration")
  );

  assert.match(source, /type PendingIllustrationInsertion = \{/);
  assert.match(source, /chapterId: string;/);
  assert.match(source, /chapterIndex: number;/);
  assert.match(source, /slotIndex: number;/);
  assert.match(chooseSlotBody, /slotIndex = Number\(slot\.dataset\.kobaImageSlot\)/);
  assert.match(chooseSlotBody, /chapterId: String\(chapter\.id \|\| ""\)/);
  assert.doesNotMatch(chooseSlotBody, /pendingInsertionSlotRef\.current = slot;/);
  assert.match(insertionBody, /querySelectorAll<HTMLElement>\("\[data-koba-image-slot\]"\)/);
  assert.match(insertionBody, /candidate\.dataset\.kobaImageSlot === String\(pendingInsertion\.slotIndex\)/);
  assert.match(insertionBody, /pendingInsertion\.chapterIndex === Number\(editor\.dataset\.kobaChapterIndex\)/);
  assert.match(insertionBody, /pendingInsertion\.chapterId === String\(editor\.dataset\.kobaChapterId \|\| ""\)/);
  assert.doesNotMatch(insertionBody, /pendingInsertion\.chapterIndex === activeChapterIndex/);
  assert.match(insertionBody, /slot\.blur\(\);\s*slot = resolveInsertionSlot\(\);/);
  assert.ok(
    insertionBody.indexOf("slot = resolveInsertionSlot()", insertionBody.indexOf("slot.blur()"))
      < insertionBody.indexOf("slot.replaceWith(figure)"),
    "The current slot must be resolved again after blur handlers refresh insertion controls."
  );
  assert.match(insertionBody, /const insertImageAtSelectedPosition = \([^)]*\): boolean =>/);
  assert.match(insertionBody, /return true;/);
  assert.match(source, /if \(!insertImageAtSelectedPosition\([^;]+\)\) return;\s*toast\(\{ title: "Image inserted"/);
  assert.match(source, /data-koba-chapter-id=\{String\(bookData\.chapters\[activeChapterIndex\]\?\.id \|\| ""\)\}/);
  assert.match(source, /data-koba-chapter-index=\{activeChapterIndex\}/);
});
