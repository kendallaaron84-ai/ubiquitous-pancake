import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";

import type { CloudTasksClient } from "@google-cloud/tasks";

import type { NexusContentSource, NexusGoal, NexusStrategySelectionMode } from "@/core/nexus/contracts";

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
  schemaVersion?: 1;
  authorId?: string;
  authorEmail?: string;
  requestedByUid?: string;
  websiteConnectionId?: string;
  contentSource?: NexusContentSource;
  universeId?: string | null;
  referenceGuideId?: string | null;
  requestedGoal?: NexusGoal | "automatic";
  strategyGuideSelectionMode?: NexusStrategySelectionMode;
  primaryStrategyGuideId?: string | null;
  primaryStrategyGuideVersion?: number;
  supportingStrategyGuideId?: string | null;
  supportingStrategyGuideVersion?: number | null;
  customDirectives?: string;
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

export const NEXUS_TASK_DISPATCH_CONFIGURATION_INVALID =
  "NEXUS_TASK_DISPATCH_CONFIGURATION_INVALID" as const;

export class CloudTasksDispatchConfigurationError extends Error {
  readonly code = NEXUS_TASK_DISPATCH_CONFIGURATION_INVALID;
  readonly status = 503;

  constructor(message = "The Content Engine task destination is not configured correctly.") {
    super(message);
    this.name = "CloudTasksDispatchConfigurationError";
  }
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
    throw normalizeCloudTasksDispatchError(error);
  }
}

export function assertBlogGenerationTaskConfiguration(): void {
  resolveConfiguration();
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

export function validateWorkerUrl(value: string): string {
  if (value.length > 2_083 || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new CloudTasksDispatchConfigurationError();
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CloudTasksDispatchConfigurationError();
  }

  const labels = parsed.hostname.split(".");
  const validDnsHostname =
    parsed.hostname.length <= 253 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    );

  if (
    parsed.protocol !== "https:" ||
    !validDnsHostname ||
    !parsed.hostname.endsWith(".run.app") ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new CloudTasksDispatchConfigurationError();
  }
  return parsed.origin;
}

export function normalizeCloudTasksDispatchError(error: unknown): unknown {
  if (
    grpcStatusCode(error) === 3 &&
    /invalid\s+url|http\s*request[^\n]*url/i.test(cloudTasksErrorMessage(error))
  ) {
    return new CloudTasksDispatchConfigurationError();
  }
  return error;
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

function cloudTasksErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error !== "object" || error === null) return "";
  const candidate = error as { message?: unknown; details?: unknown };
  return [candidate.message, candidate.details]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}
