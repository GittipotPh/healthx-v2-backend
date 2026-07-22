import { ConflictException } from "@nestjs/common";
import { OpdNoteRecordMode } from "./dto/opd-clinical-note.dto";
import { OpdDraftCopySectionCode } from "./dto/opd-draft-library.dto";
import {
  OPD_DRAFT_SNAPSHOT_SCHEMA,
  canonicalSectionHash,
  canonicalSelection,
  canonicalizeOpdDraftSnapshot,
  parseAvailableSnapshotSections,
  verifyOpdDraftSnapshot,
} from "./opd-draft-snapshot";

const paragraph = (text: string) => ({
  schema: "clinical-rich-text-v1",
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  },
});

function validCandidate(): Record<string, unknown> {
  return {
    notes: {
      selectedMode: OpdNoteRecordMode.FORM,
      sections: [
        { sectionCode: "TREATMENT", content: paragraph("rest and hydrate") },
        {
          sectionCode: "CHIEF_COMPLAINT",
          content: paragraph("headache for two days"),
        },
      ],
    },
    diagnoses: {
      items: [
        {
          codeSystem: "ICD-10",
          codeEdition: "2025",
          code: "R51.9",
          label: "Headache",
          isPrimary: true,
          onsetText: "2 days",
          note: null,
        },
      ],
    },
    intake: {
      urinaryStatus: "NORMAL",
      urinaryOtherText: null,
      bowelStatus: "NORMAL",
      bowelOtherText: null,
    },
    symptoms: {
      patientQuote: "My head hurts",
      items: [
        {
          mainCode: null,
          mainText: "Headache",
          durationValue: 2,
          durationUnit: "DAY",
          location: "Head",
          laterality: "BILATERAL",
          severity: 4,
          character: "Dull",
          modifyingFactors: null,
          staffSummary: null,
          associations: [],
        },
      ],
    },
  };
}

describe("OPD reusable draft snapshot codec", () => {
  it("canonicalizes content and emits the frozen section order", () => {
    const snapshot = canonicalizeOpdDraftSnapshot(validCandidate());

    expect(snapshot.availableSections).toEqual([
      OpdDraftCopySectionCode.SYMPTOMS,
      OpdDraftCopySectionCode.INTAKE,
      OpdDraftCopySectionCode.DIAGNOSES,
      OpdDraftCopySectionCode.NOTE_CHIEF_COMPLAINT,
      OpdDraftCopySectionCode.NOTE_TREATMENT,
    ]);
    expect(
      snapshot.content.notes?.sections.map((section) => section.sectionCode),
    ).toEqual(["CHIEF_COMPLAINT", "TREATMENT"]);
    expect(snapshot.canonicalJson).not.toContain("vital");
    expect(snapshot.canonicalJson).not.toContain("medication");
    expect(snapshot.canonicalJson).not.toContain("queue");
    expect(snapshot.contentSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("produces the same hash for object keys supplied in another order", () => {
    const first = canonicalizeOpdDraftSnapshot(validCandidate());
    const source = validCandidate();
    const reversed = Object.fromEntries(Object.entries(source).reverse());
    const second = canonicalizeOpdDraftSnapshot(reversed);

    expect(second.contentSha256).toBe(first.contentSha256);
    expect(second.canonicalJson).toBe(first.canonicalJson);
  });

  it("rejects unknown or excluded fields instead of silently snapshotting them", () => {
    expect(() =>
      canonicalizeOpdDraftSnapshot({
        ...validCandidate(),
        vitals: { pulse: 80 },
      }),
    ).toThrow(ConflictException);
  });

  it("rejects a stored snapshot whose content no longer matches its hash", () => {
    const snapshot = canonicalizeOpdDraftSnapshot(validCandidate());

    expect(() =>
      verifyOpdDraftSnapshot(
        OPD_DRAFT_SNAPSHOT_SCHEMA,
        snapshot.content,
        "0".repeat(64),
      ),
    ).toThrow(ConflictException);
  });

  it("requires a canonical, unique stored section manifest", () => {
    expect(() =>
      parseAvailableSnapshotSections([
        OpdDraftCopySectionCode.INTAKE,
        OpdDraftCopySectionCode.SYMPTOMS,
      ]),
    ).toThrow(ConflictException);
    expect(() =>
      parseAvailableSnapshotSections([
        OpdDraftCopySectionCode.SYMPTOMS,
        OpdDraftCopySectionCode.SYMPTOMS,
      ]),
    ).toThrow(ConflictException);
  });

  it("canonicalizes explicit selections and hashes sections independently", () => {
    const snapshot = canonicalizeOpdDraftSnapshot(validCandidate());
    expect(
      canonicalSelection([
        OpdDraftCopySectionCode.NOTE_TREATMENT,
        OpdDraftCopySectionCode.SYMPTOMS,
      ]),
    ).toEqual([
      OpdDraftCopySectionCode.SYMPTOMS,
      OpdDraftCopySectionCode.NOTE_TREATMENT,
    ]);
    expect(
      canonicalSectionHash(OpdDraftCopySectionCode.SYMPTOMS, snapshot.content),
    ).not.toBe(
      canonicalSectionHash(OpdDraftCopySectionCode.DIAGNOSES, snapshot.content),
    );
  });
});
