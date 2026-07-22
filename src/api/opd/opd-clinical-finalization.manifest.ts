import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { OpdClinicalFinalizationManifestDto } from "./dto/opd-clinical-finalization.dto";

export const OPD_CLINICAL_FINALIZATION_MANIFEST_SCHEMA =
  "opd-clinical-finalization-v1" as const;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

export function canonicalFinalizationManifest(
  manifest: OpdClinicalFinalizationManifestDto,
): string {
  return JSON.stringify(canonicalValue(manifest));
}

export function finalizationManifestHash(
  manifest: OpdClinicalFinalizationManifestDto,
): string {
  return createHash("sha256")
    .update(canonicalFinalizationManifest(manifest), "utf8")
    .digest("hex");
}

export function finalizationManifestJson(
  manifest: OpdClinicalFinalizationManifestDto,
): Prisma.InputJsonObject {
  return {
    schema: manifest.schema,
    encounterId: manifest.encounterId,
    encounterVersion: manifest.encounterVersion,
    examination: { ...manifest.examination },
    vitals: { ...manifest.vitals },
    intake: { ...manifest.intake },
    symptoms: { ...manifest.symptoms },
    diagnoses: { ...manifest.diagnoses },
    noteWorkspace: { ...manifest.noteWorkspace },
    noteSections: manifest.noteSections.map((section) => ({ ...section })),
    draftImport: {
      id: manifest.draftImport.id,
      sections: manifest.draftImport.sections.map((section) => ({ ...section })),
    },
    order: {
      id: manifest.order.id,
      version: manifest.order.version,
      status: manifest.order.status,
      items: manifest.order.items.map((item) => ({ ...item })),
    },
    queue: { ...manifest.queue },
    appointmentId: manifest.appointmentId,
  };
}

export function manifestsEqual(
  expected: OpdClinicalFinalizationManifestDto,
  current: OpdClinicalFinalizationManifestDto,
): boolean {
  return (
    canonicalFinalizationManifest(expected) ===
    canonicalFinalizationManifest(current)
  );
}
