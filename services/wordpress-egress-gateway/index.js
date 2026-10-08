/**
 * KOBA-I WordPress Egress Gateway
 *
 * Runs on private Cloud Run. Outbound traffic is routed through the service's
 * VPC connector and Cloud NAT so WordPress hosts see KOBA-I's static IP.
 */

import dns from "node:dns/promises";
import net from "node:net";
import express from "express";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import {
  CredentialReferenceError,
  assertCredentialReference,
  credentialSecretId,
  credentialSecretReference,
  normalizeGatewayStudioKey,
  normalizeWebsiteConnectionId,
} from "./credential-reference.js";

const PORT = Number(process.env.PORT || 8080);
const MAX_RESPONSE_BYTES = 2048;
const MAX_PUBLISH_RESPONSE_BYTES = 64 * 1024;
const WORDPRESS_TIMEOUT_MS = 15_000;

const secretProjectId =
  process.env.CONNECTION_SECRET_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  "";
const secretProjectNumber =
  process.env.CONNECTION_SECRET_PROJECT_NUMBER || "";
const contentWorkerServiceAccount =
  process.env.CONTENT_WORKER_SERVICE_ACCOUNT || "";

const secretManager = new SecretManagerServiceClient();
const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "512kb" }));

class GatewayError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.status = status;
  }
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStudioKey(value) {
  try {
    return normalizeGatewayStudioKey(value);
  } catch (error) {
    if (error instanceof CredentialReferenceError) {
      throw new GatewayError(error.code, error.message, error.status);
    }
    throw error;
  }
}

function normalizeConnectionId(value, options = {}) {
  try {
    return normalizeWebsiteConnectionId(value, options);
  } catch (error) {
    if (error instanceof CredentialReferenceError) {
      throw new GatewayError(error.code, error.message, error.status);
    }
    throw error;
  }
}

function normalizeWordPressOrigin(value) {
  let parsed;
  try {
    parsed = new URL(clean(value));
  } catch {
    throw new GatewayError(
      "INVALID_WORDPRESS_URL",
      "Enter a valid WordPress website address."
    );
  }

  if (parsed.protocol !== "https:") {
    throw new GatewayError(
      "HTTPS_REQUIRED",
      "Production WordPress connections require HTTPS."
    );
  }

  if (parsed.username || parsed.password || parsed.port) {
    throw new GatewayError(
      "INVALID_WORDPRESS_URL",
      "Use the public HTTPS address without credentials or a custom port."
    );
  }

  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.origin;
}

function isPrivateIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some(Number.isNaN)) return true;
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) return isPrivateIpv4(address);
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }
  return true;
}

async function assertPublicHostname(origin) {
  const hostname = new URL(origin).hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    net.isIP(hostname)
  ) {
    if (net.isIP(hostname) && !isPrivateIp(hostname)) return;
    throw new GatewayError(
      "PRIVATE_WORDPRESS_HOST",
      "The WordPress address must be publicly reachable."
    );
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new GatewayError(
      "WORDPRESS_DNS_FAILED",
      "We could not find that WordPress website."
    );
  }

  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    throw new GatewayError(
      "PRIVATE_WORDPRESS_HOST",
      "The WordPress address must resolve to a public server."
    );
  }
}

async function readCappedResponse(response) {
  const text = await response.text();
  return text.slice(0, MAX_RESPONSE_BYTES);
}

function classifyWordPressFailure(status, sample) {
  const lower = sample.toLowerCase();
  const firewallSignals = [
    "cloudflare",
    "wordfence",
    "mod_security",
    "modsecurity",
    "sgcaptcha",
    "access denied",
    "attention required",
  ];

  if (firewallSignals.some((signal) => lower.includes(signal))) {
    return new GatewayError(
      "FIREWALL_CHALLENGE",
      "Your website blocked the connection. Please allow KOBA-I and retry.",
      502
    );
  }

  if (status === 401 || status === 403) {
    return new GatewayError(
      "INVALID_CREDENTIALS",
      "WordPress could not confirm those credentials. Create a new Application Password and try again.",
      400
    );
  }

  if (status === 404) {
    return new GatewayError(
      "REST_API_DISABLED",
      "The WordPress REST API is unavailable on this site.",
      400
    );
  }

  return new GatewayError(
    "WORDPRESS_CONNECTION_FAILED",
    `WordPress returned HTTP ${status}.`,
    502
  );
}

async function verifyWordPress(origin, username, applicationPassword) {
  const endpoint = `${origin}/wp-json/wp/v2/users/me?context=edit`;
  let response;

  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${username}:${applicationPassword}`,
          "utf8"
        ).toString("base64")}`,
        Accept: "application/json",
        "User-Agent": "KOBA-I-CommandCenter/2.0 (+https://koba-i.com)",
      },
      signal: AbortSignal.timeout(WORDPRESS_TIMEOUT_MS),
      redirect: "error",
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new GatewayError(
      "NETWORK_TIMEOUT_TLS",
      timedOut
        ? "Your WordPress website took too long to respond."
        : "We could not securely reach your WordPress website.",
      502
    );
  }

  if (!response.ok) {
    throw classifyWordPressFailure(
      response.status,
      await readCappedResponse(response)
    );
  }

  let user;
  try {
    user = await response.json();
  } catch {
    throw new GatewayError(
      "WORDPRESS_INVALID_RESPONSE",
      "WordPress returned an unexpected response.",
      502
    );
  }

  const capabilities = user?.capabilities || {};
  if (!capabilities.edit_posts || !capabilities.upload_files) {
    throw new GatewayError(
      "INSUFFICIENT_PERMISSIONS",
      "This WordPress account needs permission to create posts and upload images.",
      400
    );
  }

  return {
    id: Number(user.id) || null,
    name: clean(user.name) || username,
  };
}

function requireSecretConfiguration() {
  const missing = [];
  if (!secretProjectId) missing.push("CONNECTION_SECRET_PROJECT_ID");
  if (!secretProjectNumber) missing.push("CONNECTION_SECRET_PROJECT_NUMBER");
  if (!contentWorkerServiceAccount) {
    missing.push("CONTENT_WORKER_SERVICE_ACCOUNT");
  }
  if (missing.length) {
    throw new GatewayError(
      "SERVICE_CONFIGURATION_ERROR",
      `Cloud Run is missing required configuration: ${missing.join(", ")}`,
      503
    );
  }
}

async function addSecretAccessor(secretName) {
  const [policyResponse] = await secretManager.getIamPolicy({
    resource: secretName,
  });
  const policy = policyResponse || {};
  const bindings = Array.isArray(policy.bindings) ? policy.bindings : [];
  const role = "roles/secretmanager.secretAccessor";
  const member = `serviceAccount:${contentWorkerServiceAccount}`;
  let binding = bindings.find((item) => item.role === role);

  if (!binding) {
    binding = { role, members: [] };
    bindings.push(binding);
  }

  const members = Array.isArray(binding.members) ? binding.members : [];
  if (!members.includes(member)) members.push(member);
  binding.members = members;
  policy.bindings = bindings;

  await secretManager.setIamPolicy({
    resource: secretName,
    policy,
  });
}

async function provisionWordPressSecret({
  studioKey,
  websiteConnectionId,
  targetWpOrigin,
  wpUsername,
  wpAppPassword,
}) {
  requireSecretConfiguration();

  const secretId = credentialSecretId(studioKey, websiteConnectionId);
  const parent = `projects/${secretProjectId}`;
  const secretName = `${parent}/secrets/${secretId}`;

  try {
    await secretManager.createSecret({
      parent,
      secretId,
      secret: { replication: { automatic: {} } },
    });
  } catch (error) {
    if (Number(error?.code) !== 6) throw error;
  }

  await secretManager.addSecretVersion({
    parent: secretName,
    payload: {
      data: Buffer.from(
        JSON.stringify({
          wordpressUrl: targetWpOrigin,
          username: wpUsername,
          applicationPassword: wpAppPassword,
        }),
        "utf8"
      ),
    },
  });

  await addSecretAccessor(secretName);

  return credentialSecretReference(
    secretProjectNumber,
    studioKey,
    websiteConnectionId
  );
}

async function loadStoredWordPressCredentials({
  studioKey,
  websiteConnectionId,
  secretCredentialRef,
  targetWpOrigin,
  wpUsername,
}) {
  requireSecretConfiguration();

  let secretName;
  try {
    secretName = assertCredentialReference({
      projectNumber: secretProjectNumber,
      studioKey,
      websiteConnectionId,
      secretCredentialRef,
    });
  } catch (error) {
    if (error instanceof CredentialReferenceError) {
      throw new GatewayError(error.code, error.message, error.status);
    }
    throw error;
  }
  let secretBuffer = null;

  try {
    const [version] = await secretManager.accessSecretVersion({
      name: secretName,
    });
    const encodedSecret = version?.payload?.data;
    if (!encodedSecret) {
      throw new GatewayError(
        "SAVED_CONNECTION_INCOMPLETE",
        "The saved WordPress connection is incomplete. Reconnect the site and retry.",
        409
      );
    }

    secretBuffer = Buffer.from(encodedSecret);
    const stored = JSON.parse(secretBuffer.toString("utf8"));
    const storedOrigin = normalizeWordPressOrigin(stored?.wordpressUrl);
    const storedUsername = clean(stored?.username);
    const applicationPassword = clean(stored?.applicationPassword);

    if (
      storedOrigin !== targetWpOrigin ||
      storedUsername !== wpUsername ||
      !applicationPassword
    ) {
      throw new GatewayError(
        "TENANT_CONNECTION_MISMATCH",
        "The saved WordPress connection does not match this author workspace.",
        403
      );
    }

    return {
      targetWpOrigin: storedOrigin,
      wpUsername: storedUsername,
      applicationPassword,
    };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (error instanceof SyntaxError) {
      throw new GatewayError(
        "SAVED_CONNECTION_INCOMPLETE",
        "The saved WordPress connection could not be read. Reconnect the site and retry.",
        409
      );
    }
    const code = Number(error?.code);
    if (code === 5) {
      throw new GatewayError(
        "SAVED_CONNECTION_NOT_FOUND",
        "No saved WordPress connection was found for this StudioKey.",
        404
      );
    }
    if (code === 7 || code === 16) {
      throw new GatewayError(
        "VAULT_ACCESS_DENIED",
        "KOBA-I could not access the protected WordPress connection.",
        503
      );
    }
    throw error;
  } finally {
    secretBuffer?.fill(0);
  }
}

function normalizePublicationPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GatewayError(
      "INVALID_PUBLICATION_PAYLOAD",
      "A publication payload is required."
    );
  }

  const assetKey = clean(value.assetKey);
  const bookTitle = clean(value.bookTitle);
  const type = clean(value.type).toLowerCase();
  const status = clean(value.status).toLowerCase();
  const price = Number(value.price ?? 0);
  const expectedPublicationId = Number(value.expectedPublicationId ?? 0);
  const expectedPageId = Number(value.expectedPageId ?? 0);

  if (!/^(?:abk|ebk)_[a-z0-9][a-z0-9_-]{0,139}$/.test(assetKey)) {
    throw new GatewayError(
      "INVALID_PUBLICATION_PAYLOAD",
      "The publication asset identifier is invalid."
    );
  }
  if (!bookTitle) {
    throw new GatewayError(
      "INVALID_PUBLICATION_PAYLOAD",
      "The publication title is required."
    );
  }
  if (type !== "audiobook" && type !== "ebook") {
    throw new GatewayError(
      "INVALID_PUBLICATION_PAYLOAD",
      "The publication media type is invalid."
    );
  }
  if (!["draft", "ready", "published"].includes(status)) {
    throw new GatewayError(
      "INVALID_PUBLICATION_PAYLOAD",
      "The publication status is invalid."
    );
  }
  if (!Number.isFinite(price) || price < 0) {
    throw new GatewayError(
      "INVALID_PUBLICATION_PAYLOAD",
      "The publication price is invalid."
    );
  }
  for (const expectedId of [expectedPublicationId, expectedPageId]) {
    if (!Number.isInteger(expectedId) || expectedId < 0) {
      throw new GatewayError(
        "INVALID_PUBLICATION_PAYLOAD",
        "The existing WordPress publication identity is invalid."
      );
    }
  }

  return {
    ...value,
    assetKey,
    bookTitle,
    bookSlug: clean(value.bookSlug) || assetKey,
    authorSlug: clean(value.authorSlug),
    authorName: clean(value.authorName),
    synopsis: clean(value.synopsis),
    coverUrl: clean(value.coverUrl),
    bgImageUrl: clean(value.bgImageUrl),
    type,
    category: clean(value.category),
    price,
    status,
    chapters: Array.isArray(value.chapters) ? value.chapters : [],
    studioTracks: Array.isArray(value.studioTracks)
      ? value.studioTracks
      : Array.isArray(value.chapters)
        ? value.chapters
        : [],
    ebookPayload: value.ebookPayload ?? null,
    expectedPublicationId,
    expectedPageId,
  };
}

async function forwardPublicationToWordPress({
  targetWpOrigin,
  wpUsername,
  applicationPassword,
  publication,
}) {
  let wordpressResponse;
  try {
    wordpressResponse = await fetch(
      `${targetWpOrigin}/wp-json/kobai/v1/publish-vault`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(
            `${wpUsername}:${applicationPassword}`,
            "utf8"
          ).toString("base64")}`,
          "Content-Type": "application/json",
          "User-Agent": "KOBA-I-CommandCenter/2.0 (+https://koba-i.com)",
        },
        body: JSON.stringify(publication),
        signal: AbortSignal.timeout(WORDPRESS_TIMEOUT_MS),
        redirect: "error",
      }
    );
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new GatewayError(
      "WORDPRESS_DEPLOYMENT_UNREACHABLE",
      timedOut
        ? "The WordPress site took too long to accept the publication."
        : "KOBA-I could not securely reach the saved WordPress site.",
      502
    );
  }

  const responseText = (
    await wordpressResponse.text()
  ).slice(0, MAX_PUBLISH_RESPONSE_BYTES);
  let payload = null;
  try {
    payload = JSON.parse(responseText);
  } catch {
    // Do not expose raw hosting or WAF HTML in public responses.
  }

  if (!wordpressResponse.ok || payload?.success !== true) {
    throw new GatewayError(
      "WORDPRESS_DEPLOYMENT_FAILED",
      clean(payload?.message) ||
        `WordPress rejected the publication deployment (HTTP ${wordpressResponse.status}).`,
      wordpressResponse.status === 409 ? 409 : 502
    );
  }

  const publicationId = Number(payload.publication_id);
  const pageId = Number(payload.page_id);
  const bookshelfPageId = Number(payload.bookshelf_page_id);
  const publicationUrl = clean(payload.url);
  const bookshelfUrl = clean(payload.bookshelf_url);
  if (
    !Number.isInteger(publicationId) ||
    publicationId <= 0 ||
    !Number.isInteger(pageId) ||
    pageId <= 0 ||
    !Number.isInteger(bookshelfPageId) ||
    bookshelfPageId <= 0 ||
    !publicationUrl ||
    !bookshelfUrl
  ) {
    throw new GatewayError(
      "WORDPRESS_DEPLOYMENT_INCOMPLETE",
      "WordPress responded, but did not confirm every required publication page.",
      502
    );
  }

  return {
    publicationId,
    pageId,
    bookshelfPageId,
    publicationUrl,
    bookshelfUrl,
  };
}

app.get("/healthz", (_request, response) => {
  response.status(200).json({
    success: true,
    service: "koba-wordpress-egress-gateway",
  });
});

app.post("/verify-wordpress", async (request, response) => {
  const startedAt = Date.now();

  try {
    const studioKey = normalizeStudioKey(request.body?.studioKey);
    const websiteConnectionId = normalizeConnectionId(
      request.body?.websiteConnectionId,
      { allowPrimaryDefault: true }
    );
    const targetWpOrigin = normalizeWordPressOrigin(
      request.body?.targetWpOrigin || request.body?.siteUrl
    );
    const wpUsername = clean(
      request.body?.wpUsername || request.body?.username
    );
    const wpAppPassword = clean(
      request.body?.wpAppPassword || request.body?.applicationPassword
    );

    if (!wpUsername || !wpAppPassword) {
      throw new GatewayError(
        "MISSING_CONNECTION_FIELDS",
        "WordPress username and Application Password are required."
      );
    }

    await assertPublicHostname(targetWpOrigin);
    const wpUser = await verifyWordPress(
      targetWpOrigin,
      wpUsername,
      wpAppPassword
    );
    const secretCredentialRef = await provisionWordPressSecret({
      studioKey,
      websiteConnectionId,
      targetWpOrigin,
      wpUsername,
      wpAppPassword,
    });

    console.info("WordPress connection verified and vaulted.", {
      studioKey,
      websiteConnectionId,
      targetWpOrigin,
      wpUserId: wpUser.id,
      durationMs: Date.now() - startedAt,
    });

    response.status(200).json({
      success: true,
      targetWpOrigin,
      wpUsername,
      wpUser,
      secretCredentialRef,
    });
  } catch (error) {
    const known =
      error instanceof GatewayError
        ? error
        : new GatewayError(
            "VAULT_PROVISION_FAIL",
            "Your site was verified, but secure setup could not finish.",
            503
          );

    console.error("WordPress egress gateway request failed.", {
      code: known.code,
      message: known.message,
      durationMs: Date.now() - startedAt,
    });

    response.status(known.status).json({
      success: false,
      code: known.code,
      error: known.message,
    });
  }
});

app.post("/publish-vault", async (request, response) => {
  const startedAt = Date.now();
  let studioKey = "";
  let websiteConnectionId = "";
  let targetWpOrigin = "";
  let assetKey = "";

  try {
    studioKey = normalizeStudioKey(request.body?.studioKey);
    websiteConnectionId = normalizeConnectionId(
      request.body?.websiteConnectionId
    );
    targetWpOrigin = normalizeWordPressOrigin(request.body?.targetWpOrigin);
    const wpUsername = clean(request.body?.wpUsername);
    if (!wpUsername) {
      throw new GatewayError(
        "MISSING_CONNECTION_FIELDS",
        "The saved WordPress username is required."
      );
    }

    await assertPublicHostname(targetWpOrigin);
    const publication = normalizePublicationPayload(request.body?.publication);
    assetKey = publication.assetKey;
    const credentials = await loadStoredWordPressCredentials({
      studioKey,
      websiteConnectionId,
      secretCredentialRef: request.body?.secretCredentialRef,
      targetWpOrigin,
      wpUsername,
    });
    const result = await forwardPublicationToWordPress({
      targetWpOrigin: credentials.targetWpOrigin,
      wpUsername: credentials.wpUsername,
      applicationPassword: credentials.applicationPassword,
      publication,
    });

    console.info("WordPress publication deployed through static egress.", {
      studioKey,
      websiteConnectionId,
      targetWpOrigin,
      assetKey,
      publicationId: result.publicationId,
      pageId: result.pageId,
      bookshelfPageId: result.bookshelfPageId,
      durationMs: Date.now() - startedAt,
    });

    response.status(200).json({
      success: true,
      targetWpOrigin,
      publication_id: result.publicationId,
      page_id: result.pageId,
      bookshelf_page_id: result.bookshelfPageId,
      url: result.publicationUrl,
      bookshelf_url: result.bookshelfUrl,
    });
  } catch (error) {
    const known =
      error instanceof GatewayError
        ? error
        : new GatewayError(
            "WORDPRESS_DEPLOYMENT_FAILED",
            "KOBA-I could not complete the WordPress publication deployment.",
            502
          );

    console.error("WordPress publication egress request failed.", {
      code: known.code,
      message: known.message,
      studioKey,
      websiteConnectionId,
      targetWpOrigin,
      assetKey,
      durationMs: Date.now() - startedAt,
    });

    response.status(known.status).json({
      success: false,
      code: known.code,
      error: known.message,
    });
  }
});

app.use((_request, response) => {
  response.status(404).json({
    success: false,
    code: "NOT_FOUND",
    error: "The requested service route does not exist.",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.info(`KOBA-I WordPress egress gateway listening on port ${PORT}.`);
});

