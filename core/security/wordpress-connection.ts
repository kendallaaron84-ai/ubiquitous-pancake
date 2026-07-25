import "server-only";

import { Buffer } from "node:buffer";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { normalizeHttpsOrigin } from "@/core/security/blog-connection";

export interface SecretManagerConnectionClient {
  createSecret(request: Record<string, unknown>): Promise<unknown>;
  addSecretVersion(request: Record<string, unknown>): Promise<unknown>;
  accessSecretVersion(request: Record<string, unknown>): Promise<unknown>;
  getIamPolicy(request: Record<string, unknown>): Promise<unknown>;
  setIamPolicy(request: Record<string, unknown>): Promise<unknown>;
}

export interface WordPressConnectionConfiguration {
  secretProjectId: string;
  secretProjectNumber: string;
  workerServiceAccount: string;
}

export interface WordPressCredentialInput {
  studioKey: string;
  targetWpOrigin: unknown;
  wpUsername: unknown;
  wpAppPassword: unknown;
}

export interface VerifiedWordPressConnection {
  studioKey: string;
  targetWpOrigin: string;
  wpUsername: string;
  secretCredentialRef: string;
}

export interface StoredWordPressConnectionInput {
  targetWpOrigin: unknown;
  wpUsername: unknown;
  secretCredentialRef: unknown;
}

export type WordPressConnectionDiagnosticCode =
  | "INVALID_CREDENTIALS"
  | "INSUFFICIENT_PERMISSIONS"
  | "FIREWALL_CHALLENGE"
  | "NETWORK_TIMEOUT_TLS"
  | "REST_API_DISABLED"
  | "VAULT_PROVISION_FAIL";

export interface WordPressConnectionDiagnosticDetails {
  httpStatus?: number;
  provider?: string;
}

export class WordPressConnectionDiagnosticError extends Error {
  constructor(
    readonly code: WordPressConnectionDiagnosticCode,
    readonly publicMessage: string,
    readonly details: WordPressConnectionDiagnosticDetails = {}
  ) {
    super(publicMessage);
    this.name = "WordPressConnectionDiagnosticError";
  }
}

const STUDIO_KEY_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const ERROR_SAMPLE_LIMIT_BYTES = 2_048;

export function loadWordPressConnectionConfiguration(
  source: NodeJS.ProcessEnv = process.env
): WordPressConnectionConfiguration {
  const developmentProjectId = "jubilee-command-center---dev";
  const secretProjectId =
    source.CONNECTION_SECRET_PROJECT_ID?.trim() ||
    source.CLOUD_TASKS_PROJECT_ID?.trim() ||
    (source.NODE_ENV === "production" ? "" : developmentProjectId);
  const secretProjectNumber =
    source.CONNECTION_SECRET_PROJECT_NUMBER?.trim() ||
    (secretProjectId === developmentProjectId ? "751521788548" : "");
  const workerServiceAccount =
    source.CONTENT_WORKER_SERVICE_ACCOUNT?.trim() ||
    (secretProjectId === developmentProjectId
      ? "content-worker-dev@jubilee-command-center---dev.iam.gserviceaccount.com"
      : "");

  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(secretProjectId)) {
    throw new Error("CONNECTION_SECRET_PROJECT_ID is invalid.");
  }
  if (!/^[0-9]{6,20}$/.test(secretProjectNumber)) {
    throw new Error("CONNECTION_SECRET_PROJECT_NUMBER is invalid.");
  }
  if (!workerServiceAccount.endsWith(".iam.gserviceaccount.com")) {
    throw new Error("CONTENT_WORKER_SERVICE_ACCOUNT is invalid.");
  }

  return { secretProjectId, secretProjectNumber, workerServiceAccount };
}

export async function verifyAndProvisionWordPressConnection(
  secretManager: SecretManagerConnectionClient,
  configuration: WordPressConnectionConfiguration,
  input: WordPressCredentialInput,
  fetchImpl: typeof fetch = fetch
): Promise<VerifiedWordPressConnection> {
  const studioKey = clean(input.studioKey);
  const wpUsername = clean(input.wpUsername);
  const wpAppPassword = clean(input.wpAppPassword);
  if (!STUDIO_KEY_PATTERN.test(studioKey)) {
    throw new Error("The signed-in workspace does not have a valid StudioKey.");
  }
  if (!wpUsername || wpUsername.length > 160) {
    throw new Error("Enter a valid WordPress username.");
  }
  if (!wpAppPassword || wpAppPassword.length > 512) {
    throw new Error("Enter a valid WordPress Application Password.");
  }

  const targetWpOrigin = normalizeHttpsOrigin(input.targetWpOrigin);
  await assertPublicWordPressHost(new URL(targetWpOrigin).hostname);
  await verifyWordPressPublishingAccess(
    fetchImpl,
    targetWpOrigin,
    wpUsername,
    wpAppPassword
  );

  const secretId = `WP_CREDS_${studioKey}`;
  const secretResourceName =
    `projects/${configuration.secretProjectId}/secrets/${secretId}`;
  const secretCredentialRef =
    `projects/${configuration.secretProjectNumber}/secrets/${secretId}/versions/latest`;
  const secretPayload = Buffer.from(
    JSON.stringify({
      wordpressUrl: targetWpOrigin,
      username: wpUsername,
      applicationPassword: wpAppPassword,
    }),
    "utf8"
  );

  try {
    await createSecretIfMissing(
      secretManager,
      configuration.secretProjectId,
      secretId
    );
    await secretManager.addSecretVersion({
      parent: secretResourceName,
      payload: { data: secretPayload },
    });
    await grantWorkerSecretAccess(
      secretManager,
      secretResourceName,
      configuration.workerServiceAccount
    );
  } catch {
    throw new WordPressConnectionDiagnosticError(
      "VAULT_PROVISION_FAIL",
      "Your site was verified, but secure setup could not finish. Please retry."
    );
  } finally {
    secretPayload.fill(0);
  }

  return { studioKey, targetWpOrigin, wpUsername, secretCredentialRef };
}

export async function verifyStoredWordPressConnection(
  secretManager: SecretManagerConnectionClient,
  input: StoredWordPressConnectionInput,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const targetWpOrigin = normalizeHttpsOrigin(input.targetWpOrigin);
  const wpUsername = clean(input.wpUsername);
  const secretCredentialRef = clean(input.secretCredentialRef);
  if (!wpUsername || !/^projects\/[0-9]+\/secrets\/WP_CREDS_[A-Za-z0-9_-]+\/versions\/latest$/.test(secretCredentialRef)) {
    throw new Error("The saved WordPress connection is incomplete.");
  }

  let response:
    | [{ payload?: { data?: Uint8Array | string | null } }]
    | { payload?: { data?: Uint8Array | string | null } };
  try {
    response = (await secretManager.accessSecretVersion({
      name: secretCredentialRef,
    })) as
      | [{ payload?: { data?: Uint8Array | string | null } }]
      | { payload?: { data?: Uint8Array | string | null } };
  } catch {
    throw new WordPressConnectionDiagnosticError(
      "VAULT_PROVISION_FAIL",
      "Your saved connection is secure, but KOBA-I could not access it right now. Please retry."
    );
  }
  const version = Array.isArray(response) ? response[0] : response;
  const encoded = version?.payload?.data;
  if (!encoded) {
    throw new WordPressConnectionDiagnosticError(
      "VAULT_PROVISION_FAIL",
      "Your saved connection is secure, but KOBA-I could not access it right now. Please retry."
    );
  }

  const secretBuffer = Buffer.isBuffer(encoded)
    ? Buffer.from(encoded)
    : typeof encoded === "string"
      ? Buffer.from(encoded, "base64")
      : Buffer.from(encoded);
  try {
    const stored = JSON.parse(secretBuffer.toString("utf8")) as {
      wordpressUrl?: unknown;
      username?: unknown;
      applicationPassword?: unknown;
    };
    const storedOrigin = normalizeHttpsOrigin(stored.wordpressUrl);
    const storedUsername = clean(stored.username);
    const storedPassword = clean(stored.applicationPassword);
    if (
      storedOrigin !== targetWpOrigin ||
      storedUsername !== wpUsername ||
      !storedPassword
    ) {
      throw new WordPressConnectionDiagnosticError(
        "VAULT_PROVISION_FAIL",
        "Your saved connection is secure, but KOBA-I could not access it right now. Please retry."
      );
    }

    await assertPublicWordPressHost(new URL(targetWpOrigin).hostname);
    await verifyWordPressPublishingAccess(
      fetchImpl,
      targetWpOrigin,
      storedUsername,
      storedPassword
    );
  } catch (error: unknown) {
    if (error instanceof WordPressConnectionDiagnosticError) throw error;
    throw new WordPressConnectionDiagnosticError(
      "VAULT_PROVISION_FAIL",
      "Your saved connection is secure, but KOBA-I could not access it right now. Please retry."
    );
  } finally {
    secretBuffer.fill(0);
  }
}

async function verifyWordPressPublishingAccess(
  fetchImpl: typeof fetch,
  targetWpOrigin: string,
  username: string,
  applicationPassword: string
): Promise<void> {
  const authorization = Buffer.from(
    `${username}:${applicationPassword}`,
    "utf8"
  ).toString("base64");
  const requestOptions: RequestInit = {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${authorization}`,
      "User-Agent": "KOBA-I-Content-Engine/2.0",
    },
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  };

  const userResponse = await fetchWordPressEndpoint(
    fetchImpl,
    `${targetWpOrigin}/wp-json/wp/v2/users/me?context=edit`,
    requestOptions
  );
  if (!userResponse.ok) {
    throw await classifyWordPressFailure(userResponse, "authentication");
  }
  if (!isJsonResponse(userResponse)) {
    const sample = await readCappedResponseSample(userResponse);
    const firewall = detectFirewallChallenge(userResponse, sample);
    if (firewall) {
      throw new WordPressConnectionDiagnosticError(
        "FIREWALL_CHALLENGE",
        "Your website blocked the connection. We recorded the issue for support.",
        { httpStatus: userResponse.status, provider: firewall }
      );
    }
    throw new WordPressConnectionDiagnosticError(
      "REST_API_DISABLED",
      "Your WordPress publishing connection is unavailable. Check that the REST API is enabled.",
      { httpStatus: userResponse.status }
    );
  }

  const user = (await userResponse.json().catch(() => null)) as
    | { id?: unknown; capabilities?: Record<string, unknown> }
    | null;
  if (
    !user ||
    typeof user.id !== "number" ||
    !Number.isInteger(user.id) ||
    user.capabilities?.edit_posts !== true ||
    user.capabilities?.upload_files !== true
  ) {
    throw new WordPressConnectionDiagnosticError(
      "INSUFFICIENT_PERMISSIONS",
      "This WordPress account needs permission to create posts and upload images."
    );
  }

  const postTypeResponse = await fetchWordPressEndpoint(
    fetchImpl,
    `${targetWpOrigin}/wp-json/wp/v2/types/post?context=edit`,
    requestOptions
  );
  if (!postTypeResponse.ok) {
    throw await classifyWordPressFailure(postTypeResponse, "publishing");
  }
}

async function fetchWordPressEndpoint(
  fetchImpl: typeof fetch,
  endpoint: string,
  requestOptions: RequestInit
): Promise<Response> {
  try {
    return await fetchImpl(endpoint, requestOptions);
  } catch {
    throw new WordPressConnectionDiagnosticError(
      "NETWORK_TIMEOUT_TLS",
      "We couldn’t reach your website right now. Your information was not saved."
    );
  }
}

async function classifyWordPressFailure(
  response: Response,
  stage: "authentication" | "publishing"
): Promise<WordPressConnectionDiagnosticError> {
  const sample = await readCappedResponseSample(response);
  const wpErrorCode = extractWordPressErrorCode(sample);
  const firewall = detectFirewallChallenge(response, sample);

  if (
    stage === "authentication" &&
    (response.status === 401 ||
      [
        "rest_not_logged_in",
        "rest_cannot_access",
        "invalid_username",
        "incorrect_password",
        "application_passwords_disabled",
      ].includes(wpErrorCode))
  ) {
    return new WordPressConnectionDiagnosticError(
      "INVALID_CREDENTIALS",
      "WordPress couldn’t confirm those credentials. Create a new Application Password and try again.",
      { httpStatus: response.status }
    );
  }

  if (firewall) {
    return new WordPressConnectionDiagnosticError(
      "FIREWALL_CHALLENGE",
      "Your website blocked the connection. We recorded the issue for support.",
      { httpStatus: response.status, provider: firewall }
    );
  }

  if (response.status === 404 || response.status === 405) {
    return new WordPressConnectionDiagnosticError(
      "REST_API_DISABLED",
      "Your WordPress publishing connection is unavailable. Check that the REST API is enabled.",
      { httpStatus: response.status }
    );
  }

  if (
    response.status === 401 ||
    response.status === 403 ||
    wpErrorCode.startsWith("rest_cannot_")
  ) {
    return new WordPressConnectionDiagnosticError(
      stage === "authentication"
        ? "INVALID_CREDENTIALS"
        : "INSUFFICIENT_PERMISSIONS",
      stage === "authentication"
        ? "WordPress couldn’t confirm those credentials. Create a new Application Password and try again."
        : "This WordPress account needs permission to create posts and upload images.",
      { httpStatus: response.status }
    );
  }

  if (response.status >= 500) {
    return new WordPressConnectionDiagnosticError(
      "NETWORK_TIMEOUT_TLS",
      "We couldn’t reach your website right now. Your information was not saved.",
      { httpStatus: response.status }
    );
  }

  return new WordPressConnectionDiagnosticError(
    "REST_API_DISABLED",
    "Your WordPress publishing connection is unavailable. Check that the REST API is enabled.",
    { httpStatus: response.status }
  );
}

function isJsonResponse(response: Response): boolean {
  return (response.headers.get("content-type") || "")
    .toLowerCase()
    .includes("json");
}

function extractWordPressErrorCode(sample: string): string {
  try {
    const parsed = JSON.parse(sample) as { code?: unknown };
    return typeof parsed.code === "string" ? parsed.code.toLowerCase() : "";
  } catch {
    return "";
  }
}

function detectFirewallChallenge(
  response: Response,
  sample: string
): string | null {
  const body = sample.toLowerCase();
  const server = (response.headers.get("server") || "").toLowerCase();
  if (
    response.headers.has("cf-ray") ||
    server.includes("cloudflare") ||
    body.includes("cloudflare") ||
    body.includes("cf-ray") ||
    body.includes("turnstile")
  ) {
    return "Cloudflare";
  }
  if (
    body.includes("wordfence") ||
    body.includes("generated by wordfence") ||
    body.includes("wfwaf")
  ) {
    return "Wordfence";
  }
  if (
    body.includes("sgcaptcha") ||
    body.includes("siteground security") ||
    body.includes("siteground captcha")
  ) {
    return "SiteGround";
  }
  if (
    body.includes("mod_security") ||
    body.includes("modsecurity") ||
    body.includes("not acceptable") ||
    (response.status === 406 && isHtmlSample(response, body))
  ) {
    return "ModSecurity";
  }
  if (
    (response.status === 403 || response.status === 429) &&
    isHtmlSample(response, body) &&
    (body.includes("access denied") ||
      body.includes("request blocked") ||
      body.includes("security check") ||
      body.includes("captcha"))
  ) {
    return "Hosting security firewall";
  }
  return null;
}

function isHtmlSample(response: Response, sample: string): boolean {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const trimmed = sample.trimStart();
  return (
    contentType.includes("text/html") ||
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html")
  );
}

async function readCappedResponseSample(
  response: Response,
  limit = ERROR_SAMPLE_LIMIT_BYTES
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = limit - length;
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(chunk);
      length += chunk.byteLength;
      if (length >= limit) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function assertPublicWordPressHost(hostname: string): Promise<void> {
  const normalized = hostname.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized === "metadata.google.internal"
  ) {
    throw new Error(
      "Connect a publicly available HTTPS WordPress site. Local development addresses cannot receive cloud publishing jobs."
    );
  }

  const directIpVersion = isIP(normalized);
  const addresses = directIpVersion
    ? [{ address: normalized, family: directIpVersion }]
    : await lookup(normalized, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new Error("The WordPress site must resolve to a public network address.");
  }
}

function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (value.includes(":")) {
    return (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      /^fe[89ab]/.test(value) ||
      value.startsWith("::ffff:127.") ||
      value.startsWith("::ffff:10.") ||
      value.startsWith("::ffff:192.168.")
    );
  }

  const octets = value.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part))
  ) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

async function createSecretIfMissing(
  secretManager: SecretManagerConnectionClient,
  projectId: string,
  secretId: string
): Promise<void> {
  try {
    await secretManager.createSecret({
      parent: `projects/${projectId}`,
      secretId,
      secret: { replication: { automatic: {} } },
    });
  } catch (error: unknown) {
    if (grpcStatusCode(error) !== 6) throw error;
  }
}

async function grantWorkerSecretAccess(
  secretManager: SecretManagerConnectionClient,
  resource: string,
  workerServiceAccount: string
): Promise<void> {
  const response = (await secretManager.getIamPolicy({ resource })) as
    | [{ bindings?: IamBinding[]; etag?: unknown }]
    | { bindings?: IamBinding[]; etag?: unknown };
  const policy = Array.isArray(response) ? response[0] || {} : response;
  const bindings = Array.isArray(policy.bindings)
    ? policy.bindings.map((binding) => ({
        role: binding.role || "",
        members: Array.isArray(binding.members) ? [...binding.members] : [],
      }))
    : [];
  const role = "roles/secretmanager.secretAccessor";
  const member = `serviceAccount:${workerServiceAccount}`;
  const existingBinding = bindings.find((binding) => binding.role === role);
  if (existingBinding) {
    if (!existingBinding.members.includes(member)) {
      existingBinding.members.push(member);
    }
  } else {
    bindings.push({ role, members: [member] });
  }

  await secretManager.setIamPolicy({
    resource,
    policy: {
      ...(policy.etag ? { etag: policy.etag } : {}),
      bindings,
    },
  });
}

interface IamBinding {
  role?: string | null;
  members?: string[] | null;
}

function grpcStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
