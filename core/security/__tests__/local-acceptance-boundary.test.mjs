import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deployRoute = await readFile(
  new URL("../../../app/api/agent/deploy/route.ts", import.meta.url),
  "utf8"
);
const firebaseClient = await readFile(
  new URL("../../firebase.ts", import.meta.url),
  "utf8"
);
const studioClient = await readFile(
  new URL("../../studio-client.ts", import.meta.url),
  "utf8"
);
const studioPublications = await readFile(
  new URL("../../../app/api/studio/publications/route.ts", import.meta.url),
  "utf8"
);
const blogConnection = await readFile(
  new URL("../blog-connection.ts", import.meta.url),
  "utf8"
);
const localGateway = await readFile(
  new URL("../../../scripts/acceptance/local-koba-dev-gateway.mjs", import.meta.url),
  "utf8"
);

test("local WordPress gateway exception remains development-only and loopback-only", () => {
  assert.match(deployRoute, /process\.env\.NODE_ENV !== "production"/);
  assert.match(deployRoute, /process\.env\.KOBA_LOCAL_ACCEPTANCE === "true"/);
  assert.match(deployRoute, /parsed\.hostname === "127\.0\.0\.1"/);
  assert.match(deployRoute, /parsed\.hostname === "localhost"/);
  assert.match(deployRoute, /getGatewayAuthClient\(\)\.getIdTokenClient/);
});

test("local media upload and preview exceptions are explicit and loopback-only", () => {
  assert.match(studioClient, /NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true"/);
  assert.match(studioClient, /target\.hostname === "127\.0\.0\.1"/);
  assert.match(studioPublications, /process\.env\.NODE_ENV === "production"/);
  assert.match(studioPublications, /process\.env\.KOBA_LOCAL_ACCEPTANCE !== "true"/);
  assert.match(studioPublications, /parsed\.hostname !== "127\.0\.0\.1"/);
  assert.match(studioPublications, /assertLocalUploadedObjectsExist/);
  assert.match(studioPublications, /storage-preview\?path=/);
  assert.match(deployRoute, /const localMediaGateway = resolveLocalMediaGateway\(\)/);
  assert.match(deployRoute, /\$\{localMediaGateway\}\/storage-preview\?path=/);
});

test("HTTP WordPress origin exception is limited to the named local acceptance host", () => {
  assert.match(blogConnection, /process\.env\.NODE_ENV !== "production"/);
  assert.match(blogConnection, /process\.env\.KOBA_LOCAL_ACCEPTANCE === "true"/);
  assert.match(blogConnection, /parsed\.hostname === "koba-dev\.local"/);
  assert.match(blogConnection, /parsed\.protocol !== "https:"/);
});

test("browser emulator connections require an explicit public local acceptance flag", () => {
  assert.match(
    firebaseClient,
    /process\.env\.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true"/
  );
  assert.match(firebaseClient, /connectAuthEmulator/);
  assert.match(firebaseClient, /connectFirestoreEmulator/);
  assert.match(firebaseClient, /connectStorageEmulator/);
});

test("local acceptance gateway permits only the two loopback Dashboard origins", () => {
  assert.match(localGateway, /"http:\/\/localhost:3000"/);
  assert.match(localGateway, /"http:\/\/127\.0\.0\.1:3000"/);
  assert.match(localGateway, /LOCAL_ORIGIN_NOT_ALLOWED/);
  assert.doesNotMatch(localGateway, /access-control-allow-origin"\s*:\s*"\*"/);
});
