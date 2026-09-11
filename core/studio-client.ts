export interface StudioUploadResult {
  storagePath: string;
  canonicalUrl: string;
  contentType: string;
}

export async function loadStudioProducts() {
  return studioRequest("/api/studio/publications", { method: "GET" });
}

export async function loadStudioProduct(assetId: string) {
  return studioRequest(
    `/api/studio/publications?assetId=${encodeURIComponent(assetId)}`,
    { method: "GET" }
  );
}

export async function saveStudioProduct(
  assetId: string,
  action: "save_studio_manifest" | "save_workbench_draft" | "attach_mastered_audio",
  payload: Record<string, unknown>
) {
  return studioRequest("/api/studio/publications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assetId, action, payload }),
  });
}

export async function uploadStudioFile(
  assetId: string,
  file: File,
  purpose: "source" | "mastered" | "illustrated_page"
): Promise<StudioUploadResult> {
  const ticket = await studioRequest("/api/studio/publications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assetId,
      action: "create_upload",
      payload: {
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        purpose,
      },
    }),
  });
  const upload = ticket.upload as StudioUploadResult & { uploadUrl?: unknown };
  if (!upload || typeof upload.uploadUrl !== "string") {
    throw new Error("Secure media upload could not be authorized.");
  }
  const target = new URL(upload.uploadUrl);
  if (target.protocol !== "https:") {
    throw new Error("Secure media upload returned an invalid destination.");
  }
  const response = await fetch(target.toString(), {
    method: "PUT",
    headers: { "Content-Type": upload.contentType },
    body: file,
  });
  if (!response.ok) {
    throw new Error("The media file could not be uploaded securely.");
  }
  return {
    storagePath: upload.storagePath,
    canonicalUrl: upload.canonicalUrl,
    contentType: upload.contentType,
  };
}

async function studioRequest(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || "The Studio could not complete this request.");
  }
  return payload;
}
