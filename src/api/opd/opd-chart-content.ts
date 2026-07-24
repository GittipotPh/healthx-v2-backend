import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  OpdChartClinicalMetadataDto,
  SaveOpdChartDocumentDto,
} from "./dto/opd-chart.dto";

export interface NormalizedOpdChartContent {
  metadata: Prisma.InputJsonObject;
  contentHash: string;
  hasClinicalMetadata: boolean;
}

export function normalizeOpdChartContent(
  dto: SaveOpdChartDocumentDto,
  rasterSha256: string,
): NormalizedOpdChartContent {
  const metadata = normalizeMetadata(dto);
  return {
    metadata,
    contentHash: hashOpdChartContent(rasterSha256, metadata),
    hasClinicalMetadata: Object.values(metadata).some(
      (value) => typeof value === "string" && value.length > 0,
    ),
  };
}

export function hashOpdChartContent(
  rasterSha256: string,
  metadata: unknown,
): string {
  return createHash("sha256")
    .update(
      canonicalizeJson({
        schema: "opd-chart-raster-v1",
        rasterSha256,
        metadata,
      }),
    )
    .digest("hex");
}

function normalizeMetadata(
  metadata: OpdChartClinicalMetadataDto,
): Prisma.InputJsonObject {
  return {
    location: metadata.location.trim(),
    character: metadata.character.trim(),
    size: metadata.size.trim(),
    side: metadata.side.trim(),
    doctorNote: metadata.doctorNote.trim(),
  };
}

function canonicalizeJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Chart JSON contains a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter((entry) => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${canonicalizeJson(entry)}`,
      )
      .join(",")}}`;
  }
  throw new Error("Chart JSON contains an unsupported value");
}
