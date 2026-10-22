import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

const PROJECT_ID = "kobai-rc2-firestore-rules-test";
const RULES = await readFile(new URL("../../../firestore.rules", import.meta.url), "utf8");
let environment;

test.before(async () => {
  environment = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: RULES } });
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users/author-a@example.com"), {
      email: "author-a@example.com", studioKey: "STUDIO-A", plan: "pro", hasContentEngineAccess: true,
    });
    await setDoc(doc(db, "users/author-b@example.com"), {
      email: "author-b@example.com", studioKey: "STUDIO-B", plan: "free",
    });
    await setDoc(doc(db, "products/book-a"), { authorEmail: "author-a@example.com", studioKey: "STUDIO-A" });
    await setDoc(doc(db, "products/book-b"), { authorEmail: "author-b@example.com", studioKey: "STUDIO-B" });
    await setDoc(doc(db, "voice_vault/voice-a"), { authorEmail: "author-a@example.com", status: "ready" });
    await setDoc(doc(db, "audiobook_requests/request-a"), { authorEmail: "author-a@example.com" });
    for (const path of ["system_config/seo_core", "steps/step_1", "saved_test_runs/run_1", "sales_pipeline/lead_1"]) {
      await setDoc(doc(db, path), { seeded: true });
    }
  });
});

test.after(async () => environment?.cleanup());

test("owner profile edits pass while privileged self-grants fail closed", async () => {
  const db = environment.authenticatedContext("author-a", { email: "author-a@example.com" }).firestore();
  await assertSucceeds(updateDoc(doc(db, "users/author-a@example.com"), { firstName: "Author", toneOfVoice: "Warm" }));
  for (const field of [
    "hasActiveLicense", "studioKey", "role", "accessScope", "plan", "subscriptionStatus",
    "hasContentEngineAccess", "hasBlogEngineAccess", "contentEngineEnabled", "blogEngineEnabled", "nexusEnabled", "pluginEntitlements",
  ]) {
    await assertFails(updateDoc(doc(db, "users/author-a@example.com"), {
      [field]: field === "hasContentEngineAccess" ? false : true,
    }));
  }
  await assertFails(getDoc(doc(db, "users/author-b@example.com")));
});

test("product and audiobook reads are tenant isolated and writes remain server owned", async () => {
  const db = environment.authenticatedContext("author-a", { email: "author-a@example.com" }).firestore();
  await assertSucceeds(getDoc(doc(db, "products/book-a")));
  await assertFails(getDoc(doc(db, "products/book-b")));
  const ownedQuery = query(collection(db, "products"), where("authorEmail", "==", "author-a@example.com"));
  assert.equal((await assertSucceeds(getDocs(ownedQuery))).size, 1);
  await assertSucceeds(getDoc(doc(db, "audiobook_requests/request-a")));
  await assertFails(setDoc(doc(db, "audiobook_requests/forged"), { authorEmail: "author-a@example.com" }));
});

test("voice records preserve tenant ownership across create, update, and delete", async () => {
  const authorA = environment.authenticatedContext("author-a", { email: "author-a@example.com" }).firestore();
  const authorB = environment.authenticatedContext("author-b", { email: "author-b@example.com" }).firestore();
  await assertSucceeds(setDoc(doc(authorA, "voice_vault/new-a"), { authorEmail: "author-a@example.com", status: "pending" }));
  await assertSucceeds(updateDoc(doc(authorA, "voice_vault/voice-a"), { status: "secured" }));
  await assertFails(updateDoc(doc(authorA, "voice_vault/voice-a"), { authorEmail: "author-b@example.com" }));
  await assertFails(getDoc(doc(authorB, "voice_vault/voice-a")));
});

test("global configuration, automation, sales, and Nexus collections are browser denied", async () => {
  const db = environment.authenticatedContext("author-a", { email: "author-a@example.com" }).firestore();
  for (const path of [
    "system_config/seo_core", "steps/step_1", "saved_test_runs/run_1", "sales_pipeline/lead_1",
    "nexus_story_worlds/world-a", "nexus_strategy_guides/guide-a",
  ]) {
    await assertFails(getDoc(doc(db, path)));
    await assertFails(setDoc(doc(db, path), { tampered: true }));
  }
});
