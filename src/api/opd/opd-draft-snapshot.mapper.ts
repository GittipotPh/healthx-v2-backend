import type { Prisma } from "@prisma/client";

export type OpdDraftSnapshotSourceRecord = Prisma.opd_encounterGetPayload<{
  include: {
    examinations: {
      include: {
        intake: true;
        symptom_section: {
          include: { symptoms: { include: { associations: true } } };
        };
      };
    };
    diagnosis_section: { include: { diagnoses: true } };
    note_workspace: { include: { sections: true } };
  };
}>;

/**
 * Builds an explicit allow-listed candidate. Validation, canonical ordering,
 * rich-text re-parsing, size enforcement, and hashing happen in the codec.
 */
export function toOpdDraftSnapshotCandidate(
  encounter: OpdDraftSnapshotSourceRecord,
): unknown {
  const examination = encounter.examinations[0];
  const symptomSection = examination?.symptom_section;
  const symptoms = symptomSection
    ? [...symptomSection.symptoms]
        .sort((left, right) => left.display_order - right.display_order)
        .map((symptom) => ({
          mainCode: symptom.main_code,
          mainText: symptom.main_text,
          durationValue: decimalNumber(symptom.duration_value),
          durationUnit: symptom.duration_unit,
          location: symptom.location,
          laterality: symptom.laterality,
          severity: symptom.severity,
          character: symptom.character,
          modifyingFactors: symptom.modifying_factors,
          staffSummary: symptom.staff_summary,
          associations: [...symptom.associations]
            .sort((left, right) => left.display_order - right.display_order)
            .map((association) => ({
              code: association.code,
              label: association.label,
            })),
        }))
    : [];
  const hasSymptoms =
    (symptomSection?.patient_quote?.trim().length ?? 0) > 0 ||
    symptoms.length > 0;

  const intake = examination?.intake;
  const diagnoses = encounter.diagnosis_section
    ? [...encounter.diagnosis_section.diagnoses]
        .sort((left, right) => left.display_order - right.display_order)
        .map((diagnosis) => ({
          codeSystem: diagnosis.code_system,
          codeEdition: diagnosis.code_edition,
          code: diagnosis.code,
          label: diagnosis.label,
          isPrimary: diagnosis.is_primary,
          onsetText: diagnosis.onset_text,
          note: diagnosis.note,
        }))
    : [];
  const noteSections = (encounter.note_workspace?.sections ?? [])
    .filter(
      (section) =>
        section.status === "DRAFT" && section.plain_text.trim().length > 0,
    )
    .sort((left, right) => left.section_code.localeCompare(right.section_code))
    .map((section) => ({
      sectionCode: section.section_code,
      content: section.rich_content,
    }));

  return {
    ...(hasSymptoms
      ? {
          symptoms: {
            patientQuote: symptomSection?.patient_quote ?? null,
            items: symptoms,
          },
        }
      : {}),
    ...(intake
      ? {
          intake: {
            urinaryStatus: intake.urinary_status,
            urinaryOtherText: intake.urinary_other_text,
            bowelStatus: intake.bowel_status,
            bowelOtherText: intake.bowel_other_text,
          },
        }
      : {}),
    ...(diagnoses.length > 0 ? { diagnoses: { items: diagnoses } } : {}),
    ...(encounter.note_workspace && noteSections.length > 0
      ? {
          notes: {
            selectedMode: encounter.note_workspace.selected_mode,
            sections: noteSections,
          },
        }
      : {}),
  };
}

function decimalNumber(value: { toString(): string } | null): number | null {
  if (value === null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}
