import { ApiProperty } from "@nestjs/swagger";
import { OpdDraftCopySectionCode } from "./dto/opd-draft-library.dto";
import type { OpdDraftSnapshotContent } from "./opd-draft-snapshot";

export class OpdDraftAuthorView {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  displayName!: string;
}

export class ReusableOpdDraftListItemView {
  @ApiProperty()
  draftSnapshotId!: string;

  @ApiProperty()
  draftCheckpointId!: string;

  @ApiProperty()
  sourceEncounterId!: string;

  @ApiProperty()
  sourceVisitAt!: string;

  @ApiProperty()
  capturedAt!: string;

  @ApiProperty()
  checkpointNumber!: number;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty({ type: OpdDraftAuthorView })
  author!: OpdDraftAuthorView;

  @ApiProperty({ enum: OpdDraftCopySectionCode, isArray: true })
  availableSections!: OpdDraftCopySectionCode[];

  @ApiProperty()
  canPreview!: boolean;
}

export class ReusableOpdDraftListView {
  @ApiProperty({ type: [ReusableOpdDraftListItemView] })
  items!: ReusableOpdDraftListItemView[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

export class ReusableOpdDraftPreviewView extends ReusableOpdDraftListItemView {
  @ApiProperty({ enum: ["opd-draft-copy-v1"] })
  schemaVersion!: "opd-draft-copy-v1";

  @ApiProperty()
  contentSha256!: string;

  @ApiProperty({ type: Object, additionalProperties: true })
  content!: OpdDraftSnapshotContent;

  @ApiProperty()
  isReusable!: boolean;
}

export class OpdDraftImportedSectionView {
  @ApiProperty({ enum: OpdDraftCopySectionCode })
  sectionCode!: OpdDraftCopySectionCode;

  @ApiProperty()
  targetResourceType!: string;

  @ApiProperty()
  targetResourceId!: string;

  @ApiProperty()
  targetResourceVersion!: number;

  @ApiProperty({ enum: ["REVIEW_REQUIRED", "REVIEWED"] })
  reviewStatus!: "REVIEW_REQUIRED" | "REVIEWED";

  @ApiProperty({ type: Number, nullable: true })
  reviewedTargetVersion!: number | null;

  @ApiProperty()
  reviewIsCurrent!: boolean;

  @ApiProperty({ type: String, nullable: true })
  reviewedByUserId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  reviewedAt!: string | null;
}

export class OpdDraftImportView {
  @ApiProperty()
  draftImportId!: string;

  @ApiProperty()
  targetEncounterId!: string;

  @ApiProperty()
  sourceSnapshotId!: string;

  @ApiProperty()
  sourceCheckpointId!: string;

  @ApiProperty()
  sourceEncounterId!: string;

  @ApiProperty({ enum: OpdDraftCopySectionCode, isArray: true })
  selectedSections!: OpdDraftCopySectionCode[];

  @ApiProperty({ type: Object, additionalProperties: true })
  targetBeforeManifest!: Record<string, unknown>;

  @ApiProperty({ type: Object, additionalProperties: true })
  targetAfterManifest!: Record<string, unknown>;

  @ApiProperty({ type: [OpdDraftImportedSectionView] })
  sections!: OpdDraftImportedSectionView[];

  @ApiProperty()
  importedByUserId!: string;

  @ApiProperty()
  importedAt!: string;

  @ApiProperty()
  allSectionsReviewed!: boolean;
}

export class CurrentOpdDraftImportView {
  @ApiProperty({ type: OpdDraftImportView, nullable: true })
  draftImport!: OpdDraftImportView | null;
}

export class ReviewImportedOpdDraftSectionView {
  @ApiProperty()
  draftImportId!: string;

  @ApiProperty({ type: OpdDraftImportedSectionView })
  section!: OpdDraftImportedSectionView;
}
