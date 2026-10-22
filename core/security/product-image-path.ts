export function buildUserScopedProductAssetPath(
  email: string,
  productId: unknown,
  type: "cover" | "bg",
  originalFileName: string
): string {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.includes("/") || normalizedEmail.includes("\\")) {
    throw new Error("A verified author email is required for image uploads.");
  }
  const safeProductId = String(productId || "product")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "product";
  const safeFileName = originalFileName
    .split(/[\\/]/)
    .pop()!
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "image";
  const slot = type === "cover" ? "coverUrl" : "bgImageUrl";
  return `users/${normalizedEmail}/assets/${safeProductId}_${slot}_${safeFileName}`;
}
