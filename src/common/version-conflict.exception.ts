import { ConflictException } from "@nestjs/common";

export interface VersionConflictMetadata {
  resourceType: string;
  resourceId: string;
  currentVersion: number;
  currentStatus?: string;
  updatedAt?: string;
}

/**
 * Stable optimistic-concurrency response for independently mutable resources.
 * It intentionally returns metadata only, never a clinical payload.
 */
export class VersionConflictException extends ConflictException {
  constructor(metadata: VersionConflictMetadata) {
    super({
      message:
        "This clinical section changed in another session. Reload before saving again.",
      code: "CLINICAL_VERSION_CONFLICT",
      ...metadata,
    });
  }
}
