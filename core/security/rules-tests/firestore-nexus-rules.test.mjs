import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const PROJECT_ID = "author-jubilee-command-center-rules-test";
const RULES = await readFile(new URL("../../../firestore.rules", import.meta.url), "utf8");
const PROTECTED_PATHS = [
  "nexus_story_worlds/world_alpha",
  "nexus_story_worlds/world_alpha/reference_guides/guide_primary",
  "nexus_story_worlds/world_alpha/reference_guides/guide_primary/versions/1",
  "nexus_story_worlds/world_alpha/reference_guides/guide_primary/versions/1/chunks/chunk_0001",
  "nexus_story_worlds/world_alpha/reference_guide_upload_requests/request_01",
  "nexus_story_worlds/world_alpha/reference_guide_audit_events/event_01",
];

let rulesEnvironment;

test.before(async () => {
  rulesEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES },
  });

  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const path of PROTECTED_PATHS) {
      await setDoc(doc(database, path), { studioKey: "KOBA-A", authorId: "author-a", seeded: true });
    }
  });
});

test.after(async () => {
  await rulesEnvironment?.cleanup();
});

test("authenticated Firebase clients cannot read any Nexus Story World knowledge record", async () => {
  const database = rulesEnvironment.authenticatedContext("author-a", { email: "author-a@example.com" }).firestore();
  for (const path of PROTECTED_PATHS) {
    await assertFails(getDoc(doc(database, path)));
  }
});

test("authenticated Firebase clients cannot write any Nexus Story World knowledge record", async () => {
  const database = rulesEnvironment.authenticatedContext("author-a", { email: "author-a@example.com" }).firestore();
  for (const path of PROTECTED_PATHS) {
    await assertFails(setDoc(doc(database, path), { studioKey: "KOBA-A", authorId: "author-a", tampered: true }));
  }
});

test("anonymous Firebase clients cannot read or write Nexus Story World knowledge", async () => {
  const database = rulesEnvironment.unauthenticatedContext().firestore();
  for (const path of PROTECTED_PATHS) {
    await assertFails(getDoc(doc(database, path)));
    await assertFails(setDoc(doc(database, path), { anonymous: true }));
  }
});

test("Firebase Admin remains able to serve the authenticated Nexus API boundary", async () => {
  await rulesEnvironment.withSecurityRulesDisabled(async (context) => {
    const snapshot = await getDoc(doc(context.firestore(), PROTECTED_PATHS[1]));
    assert.equal(snapshot.exists(), true);
    assert.equal(snapshot.data().studioKey, "KOBA-A");
  });
});

test("the narrow repair preserves authenticated browser behavior outside Nexus", async () => {
  const authenticated = rulesEnvironment.authenticatedContext("author-a", { email: "author-a@example.com" }).firestore();
  await assertSucceeds(setDoc(doc(authenticated, "users/author-a@example.com"), { displayName: "Author A" }));
  await assertSucceeds(getDoc(doc(authenticated, "users/author-a@example.com")));

  const anonymous = rulesEnvironment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonymous, "users/author-a@example.com")));
});
