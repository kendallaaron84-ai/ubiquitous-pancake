import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CloudTasksDispatchConfigurationError,
  NEXUS_TASK_DISPATCH_CONFIGURATION_INVALID,
  normalizeCloudTasksDispatchError,
  validateWorkerUrl,
} from "../../cloud-tasks.ts";

const ROOT = new URL("../../../", import.meta.url);

test("accepts an exact root Cloud Run HTTPS URL", () => {
  assert.equal(
    validateWorkerUrl("https://content-engine-worker-prod-aoosgrwosq-uc.a.run.app"),
    "https://content-engine-worker-prod-aoosgrwosq-uc.a.run.app"
  );
});

test("rejects placeholder and non-root worker URLs before dispatch", () => {
  for (const value of [
    "https://content-engine-...us-central1.run.app",
    "https://content-engine-worker-prod-aoosgrwosq-uc.a.run.app/tasks",
    "https://content-engine-worker-prod-aoosgrwosq-uc.a.run.app:8443",
  ]) {
    assert.throws(
      () => validateWorkerUrl(value),
      (error) =>
        error instanceof CloudTasksDispatchConfigurationError &&
        error.code === NEXUS_TASK_DISPATCH_CONFIGURATION_INVALID &&
        error.status === 503
    );
  }
});

test("maps Cloud Tasks INVALID_ARGUMENT URL failures to the stable infrastructure error", () => {
  const mapped = normalizeCloudTasksDispatchError({
    code: 3,
    details: "Invalid URL. Possible causes are disallowed characters.",
  });

  assert.ok(mapped instanceof CloudTasksDispatchConfigurationError);
  assert.equal(mapped.status, 503);
  assert.equal(mapped.code, NEXUS_TASK_DISPATCH_CONFIGURATION_INVALID);
});

test("does not relabel unrelated Cloud Tasks failures", () => {
  const source = { code: 3, details: "Queue name is invalid." };
  assert.equal(normalizeCloudTasksDispatchError(source), source);
});

test("Nexus validates task configuration before durable blueprint creation and returns the stable 503", async () => {
  const route = await readFile(
    new URL("app/api/nexus/blueprints/route.ts", ROOT),
    "utf8"
  );

  const validationIndex = route.indexOf("assertBlogGenerationTaskConfiguration();");
  const blueprintIdIndex = route.indexOf("blueprintId = `nexus_");
  const persistenceIndex = route.indexOf("await ref.create(blueprintData)");

  assert.ok(validationIndex >= 0);
  assert.ok(validationIndex < blueprintIdIndex);
  assert.ok(validationIndex < persistenceIndex);
  assert.match(route, /NEXUS_TASK_DISPATCH_CONFIGURATION_INVALID|error\.code/);
  assert.match(route, /new NexusRouteError\([\s\S]*error\.status/);
});
