import http from "node:http";

const HOST = "127.0.0.1";
const PORT = 9300;
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const LOCAL_DASHBOARD_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const LOCAL_READER_ORIGIN = "http://koba-dev.local";

const required = [
  "LOCAL_WP_ORIGIN",
  "LOCAL_WP_USERNAME",
  "LOCAL_WP_APP_PASSWORD",
  "LOCAL_STUDIO_KEY",
  "LOCAL_CONNECTION_ID",
  "LOCAL_SECRET_REF",
  "LOCAL_STORAGE_BUCKET",
];
for (const name of required) {
  if (!String(process.env[name] || "").trim()) {
    throw new Error(`${name} is required.`);
  }
}

const wpOrigin = new URL(process.env.LOCAL_WP_ORIGIN).origin;
if (wpOrigin !== "http://koba-dev.local") {
  throw new Error("The acceptance gateway may target only http://koba-dev.local.");
}

function json(response, status, payload) {
  response.writeHead(status, {
    "access-control-allow-methods": "GET,PUT,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function assertLocalStoragePath(value) {
  const path = String(value || "").trim().replace(/^\/+/, "");
  if (!/^studio\/(?:ebk|abk)_[a-f0-9]{32}\/[A-Za-z0-9_-]{8,128}\/(?:illustration|illustrated_page)\/[A-Za-z0-9._-]+$/i.test(path)) {
    throw new Error("INVALID_STORAGE_PATH");
  }
  return path;
}

async function uploadStorage(request, response, url) {
  const path = assertLocalStoragePath(url.searchParams.get("path"));
  const body = await readBody(request);
  const target = `http://127.0.0.1:9199/v0/b/${encodeURIComponent(process.env.LOCAL_STORAGE_BUCKET)}/o?name=${encodeURIComponent(path)}`;
  const upstream = await fetch(target, {
    method: "POST",
    headers: {
      authorization: "Bearer owner",
      "content-type": request.headers["content-type"] || "application/octet-stream",
    },
    body,
  });
  if (!upstream.ok) {
    return json(response, 502, { success: false, code: "LOCAL_STORAGE_UPLOAD_FAILED" });
  }
  return json(response, 200, { success: true, storagePath: path });
}

async function previewStorage(response, url) {
  const path = assertLocalStoragePath(url.searchParams.get("path"));
  const target = `http://127.0.0.1:9199/v0/b/${encodeURIComponent(process.env.LOCAL_STORAGE_BUCKET)}/o/${encodeURIComponent(path)}?alt=media`;
  const upstream = await fetch(target, {
    headers: { authorization: "Bearer owner" },
  });
  if (!upstream.ok) return json(response, 404, { success: false, code: "LOCAL_STORAGE_OBJECT_MISSING" });
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": upstream.headers.get("content-type") || "application/octet-stream",
  });
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function publish(request, response) {
  const body = JSON.parse((await readBody(request)).toString("utf8"));
  if (
    body.studioKey !== process.env.LOCAL_STUDIO_KEY ||
    body.websiteConnectionId !== process.env.LOCAL_CONNECTION_ID ||
    body.secretCredentialRef !== process.env.LOCAL_SECRET_REF ||
    new URL(body.targetWpOrigin).origin !== wpOrigin ||
    body.wpUsername !== process.env.LOCAL_WP_USERNAME
  ) {
    return json(response, 403, { success: false, code: "LOCAL_GATEWAY_SCOPE_MISMATCH" });
  }
  const upstream = await fetch(`${wpOrigin}/wp-json/kobai/v1/publish-vault`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${process.env.LOCAL_WP_USERNAME}:${process.env.LOCAL_WP_APP_PASSWORD}`, "utf8").toString("base64")}`,
      "content-type": "application/json",
      "user-agent": "KOBA-I-Local-Acceptance/1.0",
    },
    body: JSON.stringify(body.publication),
    redirect: "error",
  });
  const text = await upstream.text();
  if (upstream.ok) {
    const payload = JSON.parse(text);
    return json(response, upstream.status, {
      ...payload,
      targetWpOrigin: wpOrigin,
    });
  }
  response.writeHead(upstream.status, {
    "cache-control": "no-store",
    "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
  });
  response.end(text);
}

const server = http.createServer(async (request, response) => {
  try {
    const requestOrigin = String(request.headers.origin || "");
    const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
    const isStoragePreview = request.method === "GET" &&
      (url.pathname === "/storage-preview" || url.pathname.startsWith("/storage-preview/"));
    if (
      requestOrigin &&
      !LOCAL_DASHBOARD_ORIGINS.has(requestOrigin) &&
      !(isStoragePreview && requestOrigin === LOCAL_READER_ORIGIN)
    ) {
      return json(response, 403, { success: false, code: "LOCAL_ORIGIN_NOT_ALLOWED" });
    }
    if (requestOrigin) {
      response.setHeader("access-control-allow-origin", requestOrigin);
      response.setHeader("vary", "Origin");
    }
    if (request.method === "OPTIONS") return json(response, 204, {});
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json(response, 200, { success: true, environment: "local-only" });
    }
    if (request.method === "PUT" && url.pathname === "/storage-upload") {
      return await uploadStorage(request, response, url);
    }
    if (isStoragePreview) {
      return await previewStorage(response, url);
    }
    if (request.method === "POST" && url.pathname === "/publish-vault") {
      return await publish(request, response);
    }
    return json(response, 404, { success: false, code: "NOT_FOUND" });
  } catch (error) {
    const code = error instanceof Error ? error.message : "LOCAL_GATEWAY_FAILURE";
    return json(response, code === "REQUEST_TOO_LARGE" ? 413 : 400, { success: false, code });
  }
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ ready: true, host: HOST, port: PORT, target: wpOrigin }));
});
