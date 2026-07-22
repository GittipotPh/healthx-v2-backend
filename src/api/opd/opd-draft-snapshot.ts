import { createHash } from "node:crypto";
import {
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { OpdBowelStatus, OpdUrinaryStatus } from "./dto/opd-intake.dto";
import {
  OpdNoteRecordMode,
  OpdNoteSectionCode,
} from "./dto/opd-clinical-note.dto";
import { OpdDraftCopySectionCode } from "./dto/opd-draft-library.dto";
import { normalizeClinicalRichText } from "./opd-clinical-note.rich-text";

export const OPD_DRAFT_SNAPSHOT_SCHEMA = "opd-draft-copy-v1" as const;
export const OPD_DRAFT_SNAPSHOT_MAX_BYTES = 1024 * 1024;

export const OPD_DRAFT_SECTION_ORDER = [
  OpdDraftCopySectionCode.SYMPTOMS,
  OpdDraftCopySectionCode.INTAKE,
  OpdDraftCopySectionCode.DIAGNOSES,
  OpdDraftCopySectionCode.NOTE_CHIEF_COMPLAINT,
  OpdDraftCopySectionCode.NOTE_PHYSICAL_EXAMINATION,
  OpdDraftCopySectionCode.NOTE_DIAGNOSIS_NARRATIVE,
  OpdDraftCopySectionCode.NOTE_TREATMENT,
  OpdDraftCopySectionCode.NOTE_TREATMENT_PLAN,
  OpdDraftCopySectionCode.NOTE_ADDITIONAL_NOTES,
  OpdDraftCopySectionCode.NOTE_FREE_NOTE,
] as const;

const NOTE_SECTION_BY_COPY_CODE: Readonly<
  Record<OpdDraftCopySectionCode, OpdNoteSectionCode | null>
> = {
  [OpdDraftCopySectionCode.SYMPTOMS]: null,
  [OpdDraftCopySectionCode.INTAKE]: null,
  [OpdDraftCopySectionCode.DIAGNOSES]: null,
  [OpdDraftCopySectionCode.NOTE_CHIEF_COMPLAINT]:
    OpdNoteSectionCode.CHIEF_COMPLAINT,
  [OpdDraftCopySectionCode.NOTE_PHYSICAL_EXAMINATION]:
    OpdNoteSectionCode.PHYSICAL_EXAMINATION,
  [OpdDraftCopySectionCode.NOTE_DIAGNOSIS_NARRATIVE]:
    OpdNoteSectionCode.DIAGNOSIS_NARRATIVE,
  [OpdDraftCopySectionCode.NOTE_TREATMENT]: OpdNoteSectionCode.TREATMENT,
  [OpdDraftCopySectionCode.NOTE_TREATMENT_PLAN]:
    OpdNoteSectionCode.TREATMENT_PLAN,
  [OpdDraftCopySectionCode.NOTE_ADDITIONAL_NOTES]:
    OpdNoteSectionCode.ADDITIONAL_NOTES,
  [OpdDraftCopySectionCode.NOTE_FREE_NOTE]: OpdNoteSectionCode.FREE_NOTE,
};

export interface OpdDraftSnapshotAssociation {
  code: string | null;
  label: string;
}

export interface OpdDraftSnapshotSymptom {
  mainCode: string | null;
  mainText: string;
  durationValue: number | null;
  durationUnit: string | null;
  location: string | null;
  laterality: "UNSPECIFIED" | "LEFT" | "RIGHT" | "BILATERAL" | "MIDLINE" | null;
  severity: number | null;
  character: string | null;
  modifyingFactors: string | null;
  staffSummary: string | null;
  associations: OpdDraftSnapshotAssociation[];
}

export interface OpdDraftSnapshotContent {
  symptoms?: {
    patientQuote: string | null;
    items: OpdDraftSnapshotSymptom[];
  };
  intake?: {
    urinaryStatus: OpdUrinaryStatus;
    urinaryOtherText: string | null;
    bowelStatus: OpdBowelStatus;
    bowelOtherText: string | null;
  };
  diagnoses?: {
    items: Array<{
      codeSystem: string;
      codeEdition: string | null;
      code: string | null;
      label: string;
      isPrimary: boolean;
      onsetText: string | null;
      note: string | null;
    }>;
  };
  notes?: {
    selectedMode: OpdNoteRecordMode;
    sections: Array<{
      sectionCode: OpdNoteSectionCode;
      content: Prisma.InputJsonObject;
    }>;
  };
}

export interface CanonicalOpdDraftSnapshot {
  content: OpdDraftSnapshotContent;
  availableSections: OpdDraftCopySectionCode[];
  canonicalJson: string;
  contentSha256: string;
  bytes: number;
}

export function noteCodeForCopySection(
  sectionCode: OpdDraftCopySectionCode,
): OpdNoteSectionCode | null {
  return NOTE_SECTION_BY_COPY_CODE[sectionCode];
}

export function copyCodeForNoteSection(
  sectionCode: OpdNoteSectionCode,
): OpdDraftCopySectionCode {
  const entry = Object.entries(NOTE_SECTION_BY_COPY_CODE).find(
    ([, noteCode]) => noteCode === sectionCode,
  );
  if (!entry) throw new Error(`Unsupported OPD note section ${sectionCode}`);
  return entry[0] as OpdDraftCopySectionCode;
}

export function canonicalizeOpdDraftSnapshot(
  value: unknown,
): CanonicalOpdDraftSnapshot {
  const content = parseSnapshotContent(value);
  const availableSections = availableSnapshotSections(content);
  const canonicalJson = stableJson({
    schemaVersion: OPD_DRAFT_SNAPSHOT_SCHEMA,
    content,
  });
  const bytes = Buffer.byteLength(canonicalJson, "utf8");
  if (bytes > OPD_DRAFT_SNAPSHOT_MAX_BYTES) {
    throw new UnprocessableEntityException({
      code: "DRAFT_SNAPSHOT_TOO_LARGE",
      message: `Draft snapshot exceeds ${OPD_DRAFT_SNAPSHOT_MAX_BYTES} bytes`,
    });
  }
  return {
    content,
    availableSections,
    canonicalJson,
    contentSha256: sha256(canonicalJson),
    bytes,
  };
}

export function verifyOpdDraftSnapshot(
  schemaVersion: string,
  value: unknown,
  expectedHash: string,
): CanonicalOpdDraftSnapshot {
  if (schemaVersion !== OPD_DRAFT_SNAPSHOT_SCHEMA) {
    invalidSnapshot("Unsupported draft snapshot schema");
  }
  const canonical = canonicalizeOpdDraftSnapshot(value);
  if (canonical.contentSha256 !== expectedHash) {
    invalidSnapshot("Draft snapshot hash verification failed");
  }
  return canonical;
}

export function canonicalSectionHash(
  sectionCode: OpdDraftCopySectionCode,
  content: OpdDraftSnapshotContent,
): string {
  return sha256(
    stableJson({ sectionCode, value: sectionValue(sectionCode, content) }),
  );
}

export function canonicalSelection(
  sections: readonly OpdDraftCopySectionCode[],
): OpdDraftCopySectionCode[] {
  const selected = new Set(sections);
  return OPD_DRAFT_SECTION_ORDER.filter((code) => selected.has(code));
}

export function parseAvailableSnapshotSections(
  value: unknown,
): OpdDraftCopySectionCode[] {
  if (!Array.isArray(value))
    invalidSnapshot("Snapshot section manifest must be an array");
  const allowed = new Set<string>(OPD_DRAFT_SECTION_ORDER);
  const seen = new Set<string>();
  for (const section of value) {
    if (typeof section !== "string" || !allowed.has(section)) {
      invalidSnapshot(
        "Snapshot section manifest contains an unsupported section",
      );
    }
    if (seen.has(section))
      invalidSnapshot("Snapshot section manifest contains duplicates");
    seen.add(section);
  }
  const canonical = OPD_DRAFT_SECTION_ORDER.filter((section) =>
    seen.has(section),
  );
  if (stableJson(value) !== stableJson(canonical)) {
    invalidSnapshot("Snapshot section manifest is not in canonical order");
  }
  return canonical;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function toPrismaJsonObject(value: unknown): Prisma.InputJsonObject {
  const source = record(value, "JSON value");
  const result: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, child] of Object.entries(source)) {
    result[key] = toPrismaJsonValue(child);
  }
  return result;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function availableSnapshotSections(
  content: OpdDraftSnapshotContent,
): OpdDraftCopySectionCode[] {
  const available = new Set<OpdDraftCopySectionCode>();
  if (content.symptoms) available.add(OpdDraftCopySectionCode.SYMPTOMS);
  if (content.intake) available.add(OpdDraftCopySectionCode.INTAKE);
  if (content.diagnoses) available.add(OpdDraftCopySectionCode.DIAGNOSES);
  for (const section of content.notes?.sections ?? []) {
    available.add(copyCodeForNoteSection(section.sectionCode));
  }
  return OPD_DRAFT_SECTION_ORDER.filter((code) => available.has(code));
}

function sectionValue(
  sectionCode: OpdDraftCopySectionCode,
  content: OpdDraftSnapshotContent,
): unknown {
  if (sectionCode === OpdDraftCopySectionCode.SYMPTOMS) return content.symptoms;
  if (sectionCode === OpdDraftCopySectionCode.INTAKE) return content.intake;
  if (sectionCode === OpdDraftCopySectionCode.DIAGNOSES)
    return content.diagnoses;
  const noteCode = noteCodeForCopySection(sectionCode);
  return {
    selectedMode: content.notes?.selectedMode,
    section: content.notes?.sections.find(
      (candidate) => candidate.sectionCode === noteCode,
    ),
  };
}

function parseSnapshotContent(value: unknown): OpdDraftSnapshotContent {
  const root = record(value, "copyable_content");
  exactKeys(
    root,
    ["symptoms", "intake", "diagnoses", "notes"],
    "copyable_content",
  );
  return {
    ...(root.symptoms === undefined
      ? {}
      : { symptoms: parseSymptoms(root.symptoms) }),
    ...(root.intake === undefined ? {} : { intake: parseIntake(root.intake) }),
    ...(root.diagnoses === undefined
      ? {}
      : { diagnoses: parseDiagnoses(root.diagnoses) }),
    ...(root.notes === undefined ? {} : { notes: parseNotes(root.notes) }),
  };
}

function parseSymptoms(
  value: unknown,
): NonNullable<OpdDraftSnapshotContent["symptoms"]> {
  const row = record(value, "symptoms");
  exactKeys(row, ["patientQuote", "items"], "symptoms");
  const items = array(row.items, "symptoms.items", 20).map((item, index) => {
    const symptom = record(item, `symptoms.items[${index}]`);
    exactKeys(
      symptom,
      [
        "mainCode",
        "mainText",
        "durationValue",
        "durationUnit",
        "location",
        "laterality",
        "severity",
        "character",
        "modifyingFactors",
        "staffSummary",
        "associations",
      ],
      `symptoms.items[${index}]`,
    );
    const durationValue = nullableNumber(
      symptom.durationValue,
      0,
      99_999_999.99,
      `symptoms.items[${index}].durationValue`,
    );
    const durationUnit = nullableString(
      symptom.durationUnit,
      30,
      `symptoms.items[${index}].durationUnit`,
    );
    if (durationValue !== null && !durationUnit) {
      invalidSnapshot("A copied symptom duration requires a duration unit");
    }
    const laterality = nullableEnum(
      symptom.laterality,
      ["UNSPECIFIED", "LEFT", "RIGHT", "BILATERAL", "MIDLINE"] as const,
      `symptoms.items[${index}].laterality`,
    );
    const associations = array(
      symptom.associations,
      `symptoms.items[${index}].associations`,
      20,
    ).map((associationValue, associationIndex) => {
      const association = record(
        associationValue,
        `symptoms.items[${index}].associations[${associationIndex}]`,
      );
      exactKeys(
        association,
        ["code", "label"],
        `symptoms.items[${index}].associations[${associationIndex}]`,
      );
      return {
        code: nullableString(association.code, 50, "association.code"),
        label: requiredString(association.label, 200, "association.label"),
      };
    });
    return {
      mainCode: nullableString(symptom.mainCode, 50, "symptom.mainCode"),
      mainText: requiredString(symptom.mainText, 300, "symptom.mainText"),
      durationValue,
      durationUnit,
      location: nullableString(symptom.location, 200, "symptom.location"),
      laterality,
      severity: nullableInteger(symptom.severity, 0, 10, "symptom.severity"),
      character: nullableString(symptom.character, 200, "symptom.character"),
      modifyingFactors: nullableString(
        symptom.modifyingFactors,
        1000,
        "symptom.modifyingFactors",
      ),
      staffSummary: nullableString(
        symptom.staffSummary,
        4000,
        "symptom.staffSummary",
      ),
      associations,
    };
  });
  const patientQuote = nullableString(
    row.patientQuote,
    4000,
    "symptoms.patientQuote",
  );
  if (!patientQuote && items.length === 0) {
    invalidSnapshot("An empty symptom section is not reusable");
  }
  return { patientQuote, items };
}

function parseIntake(
  value: unknown,
): NonNullable<OpdDraftSnapshotContent["intake"]> {
  const row = record(value, "intake");
  exactKeys(
    row,
    ["urinaryStatus", "urinaryOtherText", "bowelStatus", "bowelOtherText"],
    "intake",
  );
  const urinaryStatus = requiredEnum(
    row.urinaryStatus,
    Object.values(OpdUrinaryStatus),
    "intake.urinaryStatus",
  );
  const bowelStatus = requiredEnum(
    row.bowelStatus,
    Object.values(OpdBowelStatus),
    "intake.bowelStatus",
  );
  const urinaryOtherText = nullableString(
    row.urinaryOtherText,
    500,
    "intake.urinaryOtherText",
  );
  const bowelOtherText = nullableString(
    row.bowelOtherText,
    500,
    "intake.bowelOtherText",
  );
  if (urinaryStatus === OpdUrinaryStatus.OTHER && !urinaryOtherText) {
    invalidSnapshot("Copied urinary OTHER status requires text");
  }
  if (urinaryStatus !== OpdUrinaryStatus.OTHER && urinaryOtherText) {
    invalidSnapshot("Copied urinary other text requires OTHER status");
  }
  if (bowelStatus === OpdBowelStatus.OTHER && !bowelOtherText) {
    invalidSnapshot("Copied bowel OTHER status requires text");
  }
  if (bowelStatus !== OpdBowelStatus.OTHER && bowelOtherText) {
    invalidSnapshot("Copied bowel other text requires OTHER status");
  }
  return { urinaryStatus, urinaryOtherText, bowelStatus, bowelOtherText };
}

function parseDiagnoses(
  value: unknown,
): NonNullable<OpdDraftSnapshotContent["diagnoses"]> {
  const row = record(value, "diagnoses");
  exactKeys(row, ["items"], "diagnoses");
  const items = array(row.items, "diagnoses.items", 30).map((item, index) => {
    const diagnosis = record(item, `diagnoses.items[${index}]`);
    exactKeys(
      diagnosis,
      [
        "codeSystem",
        "codeEdition",
        "code",
        "label",
        "isPrimary",
        "onsetText",
        "note",
      ],
      `diagnoses.items[${index}]`,
    );
    if (typeof diagnosis.isPrimary !== "boolean") {
      invalidSnapshot(`diagnoses.items[${index}].isPrimary must be boolean`);
    }
    return {
      codeSystem: requiredString(
        diagnosis.codeSystem,
        30,
        "diagnosis.codeSystem",
      ),
      codeEdition: nullableString(
        diagnosis.codeEdition,
        30,
        "diagnosis.codeEdition",
      ),
      code: nullableString(diagnosis.code, 30, "diagnosis.code"),
      label: requiredString(diagnosis.label, 300, "diagnosis.label"),
      isPrimary: diagnosis.isPrimary,
      onsetText: nullableString(
        diagnosis.onsetText,
        200,
        "diagnosis.onsetText",
      ),
      note: nullableString(diagnosis.note, 2000, "diagnosis.note"),
    };
  });
  if (items.length === 0)
    invalidSnapshot("An empty diagnosis section is not reusable");
  if (items.filter((item) => item.isPrimary).length !== 1) {
    invalidSnapshot("Copied diagnoses require exactly one primary diagnosis");
  }
  return { items };
}

function parseNotes(
  value: unknown,
): NonNullable<OpdDraftSnapshotContent["notes"]> {
  const row = record(value, "notes");
  exactKeys(row, ["selectedMode", "sections"], "notes");
  const selectedMode = requiredEnum(
    row.selectedMode,
    Object.values(OpdNoteRecordMode),
    "notes.selectedMode",
  );
  const seen = new Set<OpdNoteSectionCode>();
  const sections = array(row.sections, "notes.sections", 7)
    .map((item, index) => {
      const section = record(item, `notes.sections[${index}]`);
      exactKeys(
        section,
        ["sectionCode", "content"],
        `notes.sections[${index}]`,
      );
      const sectionCode = requiredEnum(
        section.sectionCode,
        Object.values(OpdNoteSectionCode),
        `notes.sections[${index}].sectionCode`,
      );
      if (seen.has(sectionCode))
        invalidSnapshot(`Duplicate copied note section ${sectionCode}`);
      seen.add(sectionCode);
      const normalized = normalizeClinicalRichText(section.content);
      if (!normalized.plainText.trim()) {
        invalidSnapshot(`An empty ${sectionCode} note section is not reusable`);
      }
      return { sectionCode, content: normalized.content };
    })
    .sort(
      (left, right) =>
        Object.values(OpdNoteSectionCode).indexOf(left.sectionCode) -
        Object.values(OpdNoteSectionCode).indexOf(right.sectionCode),
    );
  if (sections.length === 0)
    invalidSnapshot("An empty note workspace is not reusable");
  return { selectedMode, sections };
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toPrismaJsonValue);
  if (typeof value === "object") {
    const result: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) result[key] = toPrismaJsonValue(child);
    }
    return result;
  }
  invalidSnapshot("Snapshot contains a non-JSON value");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    invalidSnapshot(`${label} must be an object`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unexpected) invalidSnapshot(`${label}.${unexpected} is not supported`);
}

function array(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    invalidSnapshot(
      `${label} must be an array with at most ${maximum} entries`,
    );
  }
  return value;
}

function requiredString(
  value: unknown,
  maximum: number,
  label: string,
): string {
  if (typeof value !== "string") invalidSnapshot(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    invalidSnapshot(`${label} must contain 1 to ${maximum} characters`);
  }
  return normalized;
}

function nullableString(
  value: unknown,
  maximum: number,
  label: string,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string")
    invalidSnapshot(`${label} must be a string or null`);
  const normalized = value.trim();
  if (normalized.length > maximum)
    invalidSnapshot(`${label} exceeds ${maximum} characters`);
  return normalized || null;
}

function nullableNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalidSnapshot(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function nullableInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number | null {
  const parsed = nullableNumber(value, minimum, maximum, label);
  if (parsed !== null && !Number.isInteger(parsed))
    invalidSnapshot(`${label} must be an integer`);
  return parsed;
}

function nullableEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] | null {
  if (value === null || value === undefined) return null;
  return requiredEnum(value, allowed, label);
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    invalidSnapshot(`${label} is not supported`);
  }
  return value as T;
}

function invalidSnapshot(message: string): never {
  throw new ConflictException({ code: "SOURCE_NOT_REUSABLE", message });
}
