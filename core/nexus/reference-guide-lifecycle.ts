export type ReferenceGuideLifecycleStatus =
  | "processing"
  | "ready"
  | "failed"
  | "archived"
  | "incomplete";

export type ReferenceGuideLifecycleCode =
  | "REFERENCE_GUIDE_NOT_READY"
  | "REFERENCE_GUIDE_IN_USE"
  | "REFERENCE_GUIDE_ACTIVE"
  | "REFERENCE_GUIDE_DELETE_FORBIDDEN"
  | "REFERENCE_GUIDE_DUPLICATE_REQUEST";

export class ReferenceGuideLifecycleError extends Error {
  readonly code: ReferenceGuideLifecycleCode;
  readonly status: number;

  constructor(
    code: ReferenceGuideLifecycleCode,
    status: number,
    message: string
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function normalizeReferenceGuideStatus(value: Record<string, unknown>): ReferenceGuideLifecycleStatus {
  if (value.status === "archived") return "archived";
  if (value.status === "failed" || value.replacementStatus === "failed") return "failed";
  if (value.status === "ready" && typeof value.version === "number" && value.publicSafeAcknowledged === true) return "ready";
  if (["uploaded", "extracting", "indexing"].includes(String(value.status)) || ["extracting", "indexing"].includes(String(value.replacementStatus))) return "processing";
  return "incomplete";
}

export function assertGuideCanBecomeActive(status: ReferenceGuideLifecycleStatus): void {
  if (status !== "ready") {
    throw new ReferenceGuideLifecycleError("REFERENCE_GUIDE_NOT_READY", 409, "Only a ready Reference Guide can be made active.");
  }
}

export function assertGuideCanBeArchived(input: { isActive: boolean }): void {
  if (input.isActive) {
    throw new ReferenceGuideLifecycleError("REFERENCE_GUIDE_ACTIVE", 409, "Choose another ready guide or explicitly clear the active guide before archiving this one.");
  }
}

export function assertGuideCanBeDeleted(input: {
  status: ReferenceGuideLifecycleStatus;
  isActive: boolean;
  historicallyReferenced: boolean;
}): void {
  if (input.isActive) throw new ReferenceGuideLifecycleError("REFERENCE_GUIDE_ACTIVE", 409, "The active Reference Guide cannot be deleted.");
  if (input.historicallyReferenced) throw new ReferenceGuideLifecycleError("REFERENCE_GUIDE_IN_USE", 409, "This Reference Guide is retained because a draft references it.");
  if (input.status !== "failed" && input.status !== "incomplete") {
    throw new ReferenceGuideLifecycleError("REFERENCE_GUIDE_DELETE_FORBIDDEN", 409, "Only failed or incomplete, never-used Reference Guides can be permanently deleted.");
  }
}
