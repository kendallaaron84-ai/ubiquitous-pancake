import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";

const PROJECT_ID = "kobai-rc2-storage-rules-test";
const RULES = await readFile(new URL("../../../storage.rules", import.meta.url), "utf8");
let environment;

test.before(async () => {
  environment = await initializeTestEnvironment({ projectId: PROJECT_ID, storage: { rules: RULES } });
});

test.after(async () => environment?.cleanup());

test("user and voice-vault Storage paths are tenant scoped", async () => {
  const authorA = environment.authenticatedContext("author-a", { email: "author-a@example.com" }).storage();
  const authorB = environment.authenticatedContext("author-b", { email: "author-b@example.com" }).storage();
  const productImage = ref(authorA, "users/author-a@example.com/assets/book-cover.png");
  const voiceSample = ref(authorA, "vault/audio/author-a@example.com/sample.wav");
  await assertSucceeds(uploadBytes(productImage, new Uint8Array([1, 2, 3])));
  await assertSucceeds(uploadBytes(voiceSample, new Uint8Array([4, 5, 6])));
  await assertSucceeds(getBytes(productImage));
  await assertFails(getBytes(ref(authorB, "users/author-a@example.com/assets/book-cover.png")));
  await assertFails(deleteObject(ref(authorB, "vault/audio/author-a@example.com/sample.wav")));
});

test("server-owned Storage namespaces deny browser access", async () => {
  const author = environment.authenticatedContext("author-a", { email: "author-a@example.com" }).storage();
  for (const path of [
    "studio/book-a/STUDIO-A/illustrated_page/page.png",
    "system_config/foundational_constraints.pdf",
    "nexus/reference.pdf",
    "transcripts/book-a/chapter.txt",
  ]) {
    await assertFails(uploadBytes(ref(author, path), new Uint8Array([1])));
    await assertFails(getBytes(ref(author, path)));
  }
});
