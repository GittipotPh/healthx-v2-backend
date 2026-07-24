import { ApiProperty } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import {
  OPD_CHART_RASTER_SCHEMA,
  OpdChartArtifactFormat,
} from "./dto/opd-chart.dto";
import {
  OPD_CHART_CANVAS_HEIGHT,
  OPD_CHART_CANVAS_WIDTH,
  OpdChartTemplateCode,
  type OpdChartTemplateDefinition,
} from "./opd-chart-template.registry";

export type OpdChartDocumentRecord =
  Prisma.opd_chart_documentGetPayload<{
    include: { artifacts: true };
  }>;

export interface OpdChartImageAccess {
  url: string;
  expiresAt: string;
}

export class OpdChartTemplateView {
  @ApiProperty({ enum: OpdChartTemplateCode })
  templateCode!: OpdChartTemplateCode;

  @ApiProperty()
  templateVersion!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  category!: string;

  @ApiProperty()
  sample!: string;

  @ApiProperty({ enum: [OPD_CHART_CANVAS_WIDTH] })
  canvasWidth!: number;

  @ApiProperty({ enum: [OPD_CHART_CANVAS_HEIGHT] })
  canvasHeight!: number;
}

export class OpdChartClinicalMetadataView {
  @ApiProperty()
  location!: string;

  @ApiProperty()
  character!: string;

  @ApiProperty()
  size!: string;

  @ApiProperty()
  side!: string;

  @ApiProperty()
  doctorNote!: string;
}

export class OpdChartArtifactView {
  @ApiProperty({ enum: OpdChartArtifactFormat })
  format!: OpdChartArtifactFormat;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty()
  fileSizeBytes!: number;

  @ApiProperty()
  sha256!: string;

  @ApiProperty({ minimum: 1 })
  sourceDraftVersion!: number;
}

export class OpdChartDocumentView {
  @ApiProperty({ format: "uuid" })
  documentId!: string;

  @ApiProperty({ format: "uuid" })
  encounterId!: string;

  @ApiProperty({ enum: OpdChartTemplateCode })
  templateCode!: OpdChartTemplateCode;

  @ApiProperty()
  templateVersion!: string;

  @ApiProperty()
  templateName!: string;

  @ApiProperty({ enum: ["DRAFT", "FINAL"] })
  status!: "DRAFT" | "FINAL";

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ enum: [OPD_CHART_RASTER_SCHEMA] })
  contentSchema!: typeof OPD_CHART_RASTER_SCHEMA;

  @ApiProperty({ type: OpdChartClinicalMetadataView })
  metadata!: OpdChartClinicalMetadataView;

  @ApiProperty()
  contentHash!: string;

  @ApiProperty()
  rasterSha256!: string;

  @ApiProperty()
  rasterFileSizeBytes!: number;

  @ApiProperty()
  imageUrl!: string;

  @ApiProperty()
  imageUrlExpiresAt!: string;

  @ApiProperty()
  updatedBy!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ type: String, nullable: true })
  finalizedBy!: string | null;

  @ApiProperty({ type: String, nullable: true })
  finalizedAt!: string | null;

  @ApiProperty({ type: [OpdChartArtifactView] })
  artifacts!: OpdChartArtifactView[];
}

export class OpdChartDocumentListResult {
  @ApiProperty({ type: [OpdChartDocumentView] })
  documents!: OpdChartDocumentView[];
}

export class SaveOpdChartDocumentResult {
  @ApiProperty({ type: OpdChartDocumentView })
  document!: OpdChartDocumentView;

  @ApiProperty()
  noOp!: boolean;

  @ApiProperty({
    description:
      "True when the clinical save committed but best-effort object tagging/cleanup still needs reconciliation",
  })
  cleanupPending!: boolean;
}

export class FinalizeOpdChartDocumentResult {
  @ApiProperty({ type: OpdChartDocumentView })
  document!: OpdChartDocumentView;

  @ApiProperty()
  replayed!: boolean;

  @ApiProperty()
  cleanupPending!: boolean;
}

export class OpdChartArtifactAccessResult {
  @ApiProperty({ enum: OpdChartArtifactFormat })
  format!: OpdChartArtifactFormat;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  sha256!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty()
  expiresAt!: string;
}

export function toOpdChartTemplateView(
  definition: OpdChartTemplateDefinition,
): OpdChartTemplateView {
  return {
    templateCode: definition.code,
    templateVersion: definition.version,
    name: definition.name,
    category: definition.category,
    sample: definition.sample,
    canvasWidth: definition.canvasWidth,
    canvasHeight: definition.canvasHeight,
  };
}

export function toOpdChartDocumentView(
  row: OpdChartDocumentRecord,
  imageAccess: OpdChartImageAccess,
): OpdChartDocumentView {
  if (!isChartTemplateCode(row.template_code)) {
    throw new Error("Stored Chart template code is unsupported");
  }
  if (row.content_schema !== OPD_CHART_RASTER_SCHEMA) {
    throw new Error("Stored Chart content schema is unsupported");
  }
  const status = row.status === "FINAL" ? "FINAL" : "DRAFT";
  const artifacts = row.artifacts
    .map((artifact) => ({
      format:
        artifact.artifact_format === "PNG"
          ? OpdChartArtifactFormat.PNG
          : OpdChartArtifactFormat.PDF,
      mimeType: artifact.mime_type,
      fileSizeBytes: artifact.file_size_bytes,
      sha256: artifact.sha256,
      sourceDraftVersion: artifact.source_draft_version,
    }))
    .sort((left, right) => left.format.localeCompare(right.format));

  if (
    (status === "DRAFT" && !row.draft_storage_object_key) ||
    (status === "FINAL" &&
      !artifacts.some(
        (artifact) => artifact.format === OpdChartArtifactFormat.PNG,
      ))
  ) {
    throw new Error("Stored Chart raster pointer is inconsistent");
  }

  return {
    documentId: row.chart_document_id,
    encounterId: row.encounter_id,
    templateCode: row.template_code,
    templateVersion: row.template_version,
    templateName: row.template_name_snapshot,
    status,
    version: row.version,
    contentSchema: OPD_CHART_RASTER_SCHEMA,
    metadata: parseMetadata(row.clinical_metadata),
    contentHash: row.content_sha256,
    rasterSha256: row.raster_sha256,
    rasterFileSizeBytes: row.raster_file_size_bytes,
    imageUrl: imageAccess.url,
    imageUrlExpiresAt: imageAccess.expiresAt,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
    finalizedBy: row.finalized_by,
    finalizedAt: row.finalized_at?.toISOString() ?? null,
    artifacts,
  };
}

function parseMetadata(
  value: Prisma.JsonValue,
): OpdChartClinicalMetadataView {
  const object = requireObject(value, "Chart clinical metadata");
  return {
    location: requireString(object, "location"),
    character: requireString(object, "character"),
    size: requireString(object, "size"),
    side: requireString(object, "side"),
    doctorNote: requireString(object, "doctorNote"),
  };
}

function requireObject(
  value: Prisma.JsonValue,
  label: string,
): Prisma.JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} is not a JSON object`);
  }
  return value;
}

function requireString(object: Prisma.JsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== "string") {
    throw new Error(`Stored Chart ${key} is not a string`);
  }
  return value;
}

function isChartTemplateCode(value: string): value is OpdChartTemplateCode {
  return new Set<string>(Object.values(OpdChartTemplateCode)).has(value);
}
