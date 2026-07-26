import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";

import type { CloudTasksClient } from "@google-cloud/tasks";

export interface BlogSeoStrategy {
  primary: string;
  secondary: string;
  longTail: string;
  allKeywords: string[];
  framework: "rank_math";
  readabilityTarget: "grade_5_6";
}

export interface BlogGenerationTaskPayload {
  blueprintId: string;
  generationAttemptId: string;
  studioKey: string;
  targetWpOrigin: string;
  secretCredentialRef: string;
  seo: BlogSeoStrategy;
}

export interface AudiobookTranscriptionTaskPayload {
  jobType: "audiobook_transcription";
  jobId: string;
  transcriptionAttemptId: string;
  assetId: string;
  studioKey: string;
}

interface CloudTasksConfiguration {
  projectId: string;
  location: string;
  queue: string;
  invokerServiceAccount: string;
  workerUrl: string;
  hmacSecret: string;
}

let sharedClient: CloudTasksClient | null = null;
const nodeRequire = createRequire(import.meta.url);

export async function dispatchBlogGenerationTask(
  payload: BlogGenerationTaskPayload
): Promise<{ taskName: string; deduplicated: boolean }> {
  const config = resolveConfiguration();
  const client = sharedClient || createCloudTasksClient(config.projectId);
  sharedClient = client;

  const parent = client.queuePath(
    config.projectId,
    config.location,
    config.queue
  );
  const digest = createHash("sha256")
    .update(`${payload.blueprintId}:${payload.generationAttemptId}`)
    .digest("hex");
  const taskName = `${parent}/tasks/blog-${digest}`;
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = createHmac("sha256", config.hmacSecret)
    .update(body)
    .digest("hex");

  try {
    const [task] = await client.createTask({
      parent,
      task: {
        name: taskName,
        dispatchDeadline: { seconds: 900 },
        httpRequest: {
          httpMethod: "POST",
          url: config.workerUrl,
          headers: {
            "Content-Type": "application/json",
            "X-KOBA-Task-Signature": signature,
          },
          body: body.toString("base64"),
          oidcToken: {
            serviceAccountEmail: config.invokerServiceAccount,
            audience: config.workerUrl,
          },
        },
      },
    });

    return { taskName: task.name || taskName, deduplicated: false };
  } catch (error: unknown) {
    if (grpcStatusCode(error) === 6) {
      return { taskName, deduplicated: true };
    }
    throw error;
  }
}

export async function dispatchAudiobookTranscriptionTask(
  payload: AudiobookTranscriptionTaskPayload
): Promise<{ taskName: string; deduplicated: boolean }> {
  return dispatchTask(
    payload,
    `transcription:${payload.jobId}:${payload.transcriptionAttemptId}`,
    "transcription"
  );
}

async function dispatchTask(
  payload: object,
  identity: string,
  prefix: string
): Promise<{ taskName: string; deduplicated: boolean }> {
  const config = resolveConfiguration();
  const client = sharedClient || createCloudTasksClient(config.projectId);
  sharedClient = client;
  const parent = client.queuePath(config.projectId, config.location, config.queue);
  const digest = createHash("sha256").update(identity).digest("hex");
  const taskName = `${parent}/tasks/${prefix}-${digest}`;
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = createHmac("sha256", config.hmacSecret).update(body).digest("hex");

  try {
    const [task] = await client.createTask({
      parent,
      task: {
        name: taskName,
        dispatchDeadline: { seconds: 900 },
        httpRequest: {
          httpMethod: "POST",
          url: config.workerUrl,
          headers: {
            "Content-Type": "application/json",
            "X-KOBA-Task-Signature": signature,
          },
          body: body.toString("base64"),
          oidcToken: {
            serviceAccountEmail: config.invokerServiceAccount,
            audience: config.workerUrl,
          },
        },
      },
    });
    return { taskName: task.name || taskName, deduplicated: false };
  } catch (error: unknown) {
    if (grpcStatusCode(error) === 6) return { taskName, deduplicated: true };
    throw error;
  }
}

function createCloudTasksClient(projectId: string): CloudTasksClient {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin service-account credentials are required for Cloud Tasks."
    );
  }

  const { CloudTasksClient: CloudTasksClientConstructor } = nodeRequire(
    "@google-cloud/tasks"
  ) as typeof import("@google-cloud/tasks");

  return new CloudTasksClientConstructor({
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  });
}

function resolveConfiguration(): CloudTasksConfiguration {
  const projectId = requiredEnvironment("CLOUD_TASKS_PROJECT_ID");
  const location = requiredEnvironment("CLOUD_TASKS_LOCATION");
  const queue = requiredEnvironment("CLOUD_TASKS_QUEUE");
  const invokerServiceAccount = requiredEnvironment(
    "CLOUD_TASKS_INVOKER_SERVICE_ACCOUNT"
  );
  const workerUrl = validateWorkerUrl(
    requiredEnvironment("PYTHON_CONTENT_ENGINE_URL")
  );
  const hmacSecret = requiredEnvironment("KOBA_TASK_HMAC_SECRET");

  if (!/^[a-z][a-z0-9-]{2,62}$/.test(projectId)) {
    throw new Error("CLOUD_TASKS_PROJECT_ID is invalid.");
  }
  if (!/^[a-z0-9-]{2,63}$/.test(location)) {
    throw new Error("CLOUD_TASKS_LOCATION is invalid.");
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(queue)) {
    throw new Error("CLOUD_TASKS_QUEUE is invalid.");
  }
  if (!invokerServiceAccount.endsWith(".iam.gserviceaccount.com")) {
    throw new Error("CLOUD_TASKS_INVOKER_SERVICE_ACCOUNT is invalid.");
  }
  if (hmacSecret.length < 32) {
    throw new Error("KOBA_TASK_HMAC_SECRET must contain at least 32 characters.");
  }

  return {
    projectId,
    location,
    queue,
    invokerServiceAccount,
    workerUrl,
    hmacSecret,
  };
}

function validateWorkerUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("PYTHON_CONTENT_ENGINE_URL is invalid.");
  }

  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".run.app") ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("PYTHON_CONTENT_ENGINE_URL must be a root Cloud Run HTTPS URL.");
  }
  return parsed.origin;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function grpcStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}
