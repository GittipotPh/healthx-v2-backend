import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { StorageService } from "../src/common/storage/storage.service";
import { PrismaService } from "../src/prisma.service";

interface CountRow {
  count: bigint;
}

interface BackfillCandidateCountRow {
  valid_missing: bigint;
  invalid_date: bigint;
}

interface SequenceLagRow {
  clinic_id: string;
  branch_id: string;
  number_kind: string;
  period_key: string;
  next_value: bigint | null;
  required_next_value: bigint;
}

interface EvidenceObjectRow {
  verification_id: string;
  signature_bucket_name: string;
  signature_object_key: string;
  signature_bytes: number;
  signature_hash: string;
  pdf_bucket_name: string;
  pdf_object_key: string;
  pdf_bytes: number;
  pdf_hash: string;
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const report = await prisma.$transaction(
      async (tx) => {
        const ticketCount = await tx.opd_queue_ticket.count();
        const encounterCount = await tx.opd_encounter.count();
        const intakeCount = await tx.opd_intake.count();
        const orderCount = await tx.opd_order.count();
        const orderItemCount = await tx.opd_order_item.count();
        const medicationInstructionCount =
          await tx.opd_medication_instruction.count();
        const orderReleaseCount = await tx.opd_order_release.count();
        const orderReleaseItemCount = await tx.opd_order_release_item.count();
        const orderPrescriptionLinkCount =
          await tx.opd_order_prescription_link.count();
        const orderSaleLinkCount = await tx.opd_order_sale_link.count();
        const courseReservationCount = await tx.opd_course_reservation.count();
        const courseReservationItemCount =
          await tx.opd_course_reservation_item.count();
        const courseReservationComponentCount =
          await tx.opd_course_reservation_component.count();
        const courseReservationOperatorCount =
          await tx.opd_course_reservation_operator.count();
        const courseVerificationCount =
          await tx.opd_course_verification.count();
        const courseVerificationComponentCount =
          await tx.opd_course_verification_component.count();
        const courseCompensationRequestCount =
          await tx.opd_course_compensation_request.count();
        const courseCompensationComponentCount =
          await tx.opd_course_compensation_component.count();
        const draftSnapshotCount = await tx.opd_draft_snapshot.count();
        const draftImportCount = await tx.opd_draft_import.count();
        const draftImportSectionCount =
          await tx.opd_draft_import_section.count();
        const clinicalFinalizationCount =
          await tx.opd_clinical_finalization.count();
        const candidateCounts = await tx.$queryRaw<BackfillCandidateCountRow[]>(
          Prisma.sql`
          WITH candidate AS (
            SELECT
              a.appointment_id,
              a.clinic_id,
              a.branch_id,
              a.date_appointment,
              ticket.queue_ticket_id AS ticket_id,
              CASE
                WHEN a.date_appointment ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                 AND SUBSTRING(a.date_appointment, 1, 4)::INTEGER BETWEEN 1 AND 9999
                 AND SUBSTRING(a.date_appointment, 6, 2)::INTEGER BETWEEN 1 AND 12
                 AND SUBSTRING(a.date_appointment, 9, 2)::INTEGER BETWEEN 1 AND 31
                THEN CASE
                  WHEN SUBSTRING(a.date_appointment, 9, 2)::INTEGER <= EXTRACT(
                    DAY FROM (
                      MAKE_DATE(
                        SUBSTRING(a.date_appointment, 1, 4)::INTEGER,
                        SUBSTRING(a.date_appointment, 6, 2)::INTEGER,
                        1
                      ) + INTERVAL '1 month - 1 day'
                    )
                  )
                  THEN MAKE_DATE(
                    SUBSTRING(a.date_appointment, 1, 4)::INTEGER,
                    SUBSTRING(a.date_appointment, 6, 2)::INTEGER,
                    SUBSTRING(a.date_appointment, 9, 2)::INTEGER
                  )
                  ELSE NULL
                END
                ELSE NULL
              END AS business_date
            FROM appointment AS a
            INNER JOIN queue_status AS qs
              ON qs.appointment_id = a.appointment_id
             AND qs.clinic_id = a.clinic_id
             AND qs.branch_id = a.branch_id
            LEFT JOIN opd_queue_ticket AS ticket
              ON ticket.clinic_id = a.clinic_id
             AND ticket.branch_id = a.branch_id
             AND ticket.appointment_id = a.appointment_id
          )
          SELECT
            COUNT(*) FILTER (
              WHERE ticket_id IS NULL AND business_date IS NOT NULL
            )::BIGINT AS valid_missing,
            COUNT(*) FILTER (
              WHERE business_date IS NULL
            )::BIGINT AS invalid_date
          FROM candidate
        `,
        );
        const scopeMismatches = await tx.$queryRaw<CountRow[]>(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM appointment AS a
          INNER JOIN queue_status AS qs
            ON qs.appointment_id = a.appointment_id
          WHERE qs.clinic_id <> a.clinic_id
             OR qs.branch_id <> a.branch_id
        `);
        const excludedLegacyAppointments = await tx.$queryRaw<CountRow[]>(
          Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM appointment AS appointment
          WHERE NOT EXISTS (
            SELECT 1
            FROM queue_status AS legacy_queue
            WHERE legacy_queue.appointment_id = appointment.appointment_id
              AND legacy_queue.clinic_id = appointment.clinic_id
              AND legacy_queue.branch_id = appointment.branch_id
          )
        `,
        );
        const ticketAppointmentMismatches = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM opd_queue_ticket AS ticket
          LEFT JOIN appointment AS appointment
            ON appointment.appointment_id = ticket.appointment_id
          LEFT JOIN queue_status AS legacy_queue
            ON legacy_queue.queue_status_id = ticket.legacy_queue_status_id
          WHERE (
            ticket.source_type = 'APPOINTMENT'
            AND (
              appointment.appointment_id IS NULL
              OR appointment.clinic_id IS DISTINCT FROM ticket.clinic_id
              OR appointment.branch_id IS DISTINCT FROM ticket.branch_id
              OR appointment.customer_id IS DISTINCT FROM ticket.customer_id
              OR appointment.date_appointment IS DISTINCT FROM
                 TO_CHAR(ticket.business_date, 'YYYY-MM-DD')
              OR legacy_queue.queue_status_id IS NULL
              OR legacy_queue.appointment_id IS DISTINCT FROM ticket.appointment_id
              OR legacy_queue.clinic_id IS DISTINCT FROM ticket.clinic_id
              OR legacy_queue.branch_id IS DISTINCT FROM ticket.branch_id
              OR legacy_queue.current_step IS DISTINCT FROM ticket.current_step
            )
          ) OR (
            ticket.source_type = 'WALK_IN'
            AND (
              ticket.appointment_id IS NOT NULL
              OR ticket.legacy_queue_status_id IS NOT NULL
            )
          )
        `);
        const encounterTicketMismatches = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM opd_encounter AS encounter
          INNER JOIN opd_queue_ticket AS ticket
            ON ticket.queue_ticket_id = encounter.queue_ticket_id
           AND ticket.clinic_id = encounter.clinic_id
           AND ticket.branch_id = encounter.branch_id
          WHERE ticket.customer_id IS DISTINCT FROM encounter.customer_id
             OR ticket.appointment_id IS DISTINCT FROM encounter.appointment_id
             OR ticket.business_date IS DISTINCT FROM encounter.business_date
             OR (
               encounter.encounter_type IN ('APPOINTMENT', 'WALK_IN')
               AND encounter.encounter_type IS DISTINCT FROM ticket.source_type
             )
        `);
        const encounterLegacyOpdMismatches = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM opd_encounter AS encounter
          LEFT JOIN opd AS legacy_opd
            ON legacy_opd.opd_id = encounter.legacy_opd_id
           AND legacy_opd.branch_id = encounter.branch_id
          LEFT JOIN appointment AS appointment
            ON appointment.appointment_id = encounter.appointment_id
           AND appointment.clinic_id = encounter.clinic_id
           AND appointment.branch_id = encounter.branch_id
          WHERE encounter.legacy_opd_id IS NULL
             OR legacy_opd.opd_id IS NULL
             OR legacy_opd.clinic_id IS DISTINCT FROM encounter.clinic_id
             OR legacy_opd.customer_id IS DISTINCT FROM encounter.customer_id
             OR (
               encounter.encounter_type = 'APPOINTMENT'
               AND (
                 appointment.appointment_id IS NULL
                 OR appointment.customer_id IS DISTINCT FROM encounter.customer_id
                 OR appointment.opd_id IS DISTINCT FROM encounter.legacy_opd_id
               )
             )
             OR legacy_opd.status_opd::TEXT IS DISTINCT FROM CASE
               WHEN encounter.workflow_status IN ('OPEN', 'POST_VISIT') THEN 'PENDING'
               WHEN encounter.workflow_status = 'CLOSED' THEN 'SUCCESS'
               WHEN encounter.workflow_status = 'CANCELLED' THEN 'CANCEL'
             END
        `);
        const missingPhaseOneRoleGrants = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          WITH required(role_id, permission_id) AS (
            VALUES
              ('DOCTOR'::role_enum, 'OPD_READ'),
              ('DOCTOR'::role_enum, 'OPD_CREATE'),
              ('DOCTOR'::role_enum, 'OPD_EDIT'),
              ('NURSE'::role_enum, 'OPD_READ'),
              ('NURSE'::role_enum, 'OPD_CREATE'),
              ('NURSE'::role_enum, 'OPD_EDIT')
          )
          SELECT COUNT(*)::BIGINT AS count
          FROM required
          LEFT JOIN default_permission AS granted
            ON granted.role_id = required.role_id
           AND granted.permission_id = required.permission_id
          WHERE granted.permission_id IS NULL
        `);
        const missingCorrectionPermission = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT CASE WHEN EXISTS (
            SELECT 1
            FROM permission
            WHERE permission_id = 'OPD_CORRECT'
          ) THEN 0 ELSE 1 END::BIGINT AS count
        `);
        const correctionChainMismatches = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM opd_examination AS revision
          LEFT JOIN opd_examination AS source
            ON source.examination_id = revision.supersedes_examination_id
           AND source.clinic_id = revision.clinic_id
           AND source.branch_id = revision.branch_id
           AND source.encounter_id = revision.encounter_id
          LEFT JOIN opd_examination AS root
            ON root.examination_id = revision.corrects_examination_id
           AND root.clinic_id = revision.clinic_id
           AND root.branch_id = revision.branch_id
           AND root.encounter_id = revision.encounter_id
          WHERE revision.supersedes_examination_id IS NOT NULL
            AND (
              source.examination_id IS NULL
              OR root.examination_id IS NULL
              OR root.corrects_examination_id IS NOT NULL
              OR root.supersedes_examination_id IS NOT NULL
              OR (
                source.examination_id IS DISTINCT FROM revision.corrects_examination_id
                AND source.corrects_examination_id IS DISTINCT FROM revision.corrects_examination_id
              )
              OR (
                revision.status = 'DRAFT'
                AND (
                  source.status IS DISTINCT FROM 'FINAL'
                  OR source.version IS DISTINCT FROM revision.correction_source_version
                )
              )
              OR (
                revision.status IN ('FINAL', 'CORRECTED')
                AND (
                  source.status IS DISTINCT FROM 'CORRECTED'
                  OR source.version IS DISTINCT FROM revision.correction_source_version + 1
                )
              )
              OR revision.status NOT IN ('DRAFT', 'FINAL', 'CORRECTED')
            )
        `);
        const clinicalNoteIntegrityMismatches = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM (
            SELECT workspace.note_workspace_id::TEXT AS resource_id
            FROM opd_note_workspace AS workspace
            LEFT JOIN opd_encounter AS encounter
              ON encounter.encounter_id = workspace.encounter_id
             AND encounter.clinic_id = workspace.clinic_id
             AND encounter.branch_id = workspace.branch_id
            WHERE encounter.encounter_id IS NULL
               OR workspace.selected_mode NOT IN ('FORM', 'FREE')
               OR workspace.version < 1

            UNION ALL

            SELECT section.note_section_id::TEXT AS resource_id
            FROM opd_note_section AS section
            LEFT JOIN opd_note_workspace AS workspace
              ON workspace.note_workspace_id = section.note_workspace_id
             AND workspace.encounter_id = section.encounter_id
             AND workspace.clinic_id = section.clinic_id
             AND workspace.branch_id = section.branch_id
            WHERE workspace.note_workspace_id IS NULL
               OR section.section_code NOT IN (
                 'CHIEF_COMPLAINT',
                 'PHYSICAL_EXAMINATION',
                 'DIAGNOSIS_NARRATIVE',
                 'TREATMENT',
                 'TREATMENT_PLAN',
                 'ADDITIONAL_NOTES',
                 'FREE_NOTE'
               )
               OR section.content_schema IS DISTINCT FROM 'clinical-rich-text-v1'
               OR JSONB_TYPEOF(section.rich_content) IS DISTINCT FROM 'object'
               OR section.rich_content ->> 'schema' IS DISTINCT FROM section.content_schema
               OR section.status NOT IN ('DRAFT', 'FINAL', 'CORRECTED', 'VOID')
               OR section.version < 1
               OR CHAR_LENGTH(section.plain_text) > 50000
          ) AS mismatch
        `);
        const intakeIntegrityMismatches = await tx.$queryRaw<CountRow[]>(
          Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM opd_intake AS intake
          LEFT JOIN opd_examination AS examination
            ON examination.examination_id = intake.examination_id
           AND examination.encounter_id = intake.encounter_id
           AND examination.clinic_id = intake.clinic_id
           AND examination.branch_id = intake.branch_id
          WHERE examination.examination_id IS NULL
             OR intake.urinary_status NOT IN (
               'NORMAL', 'DYSURIA', 'FREQUENCY', 'RETENTION', 'OTHER'
             )
             OR intake.bowel_status NOT IN (
               'NORMAL', 'CONSTIPATION', 'DIARRHEA',
               'NO_BOWEL_MOVEMENT', 'OTHER'
             )
             OR (
               intake.urinary_status = 'OTHER'
               AND NULLIF(BTRIM(intake.urinary_other_text), '') IS NULL
             )
             OR (
               intake.urinary_status <> 'OTHER'
               AND intake.urinary_other_text IS NOT NULL
             )
             OR (
               intake.bowel_status = 'OTHER'
               AND NULLIF(BTRIM(intake.bowel_other_text), '') IS NULL
             )
             OR (
               intake.bowel_status <> 'OTHER'
               AND intake.bowel_other_text IS NOT NULL
             )
             OR intake.version < 1
        `,
        );
        const orderIntegrityMismatches = await tx.$queryRaw<CountRow[]>(
          Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM (
            SELECT app_order.order_id::TEXT AS resource_id
            FROM opd_order AS app_order
            LEFT JOIN opd_encounter AS encounter
              ON encounter.encounter_id = app_order.encounter_id
             AND encounter.clinic_id = app_order.clinic_id
             AND encounter.branch_id = app_order.branch_id
            LEFT JOIN opd_order_release AS release
              ON release.order_id = app_order.order_id
             AND release.encounter_id = app_order.encounter_id
             AND release.clinic_id = app_order.clinic_id
             AND release.branch_id = app_order.branch_id
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(item.gross_amount), 0) AS subtotal
              FROM opd_order_item AS item
              WHERE item.order_id = app_order.order_id
                AND item.encounter_id = app_order.encounter_id
                AND item.clinic_id = app_order.clinic_id
                AND item.branch_id = app_order.branch_id
                AND item.status = 'ACTIVE'
            ) AS item_total ON TRUE
            WHERE encounter.encounter_id IS NULL
               OR app_order.status NOT IN ('DRAFT', 'RELEASED', 'VOIDED')
               OR app_order.currency IS DISTINCT FROM 'THB'
               OR app_order.version < 1
               OR app_order.subtotal_amount < 0
               OR app_order.discount_total_amount < 0
               OR app_order.discount_total_amount > app_order.subtotal_amount
               OR app_order.tax_total_amount IS DISTINCT FROM 0::DECIMAL
               OR app_order.net_total_amount IS DISTINCT FROM ROUND(
                 app_order.subtotal_amount - app_order.discount_total_amount,
                 2
               )
               OR (
                 app_order.status = 'DRAFT'
                 AND (
                   release.release_id IS NOT NULL
                   OR app_order.released_by IS NOT NULL
                   OR app_order.released_at IS NOT NULL
                   OR app_order.voided_by IS NOT NULL
                   OR app_order.voided_at IS NOT NULL
                   OR app_order.void_reason IS NOT NULL
                   OR app_order.discount_total_amount IS DISTINCT FROM 0::DECIMAL
                   OR app_order.net_total_amount IS DISTINCT FROM app_order.subtotal_amount
                   OR app_order.subtotal_amount IS DISTINCT FROM item_total.subtotal
                 )
               )
               OR (
                 app_order.status IN ('RELEASED', 'VOIDED')
                 AND (
                   release.release_id IS NULL
                   OR app_order.released_by IS DISTINCT FROM release.released_by
                   OR app_order.released_at IS DISTINCT FROM release.released_at
                   OR app_order.subtotal_amount IS DISTINCT FROM release.subtotal_amount
                   OR app_order.discount_total_amount IS DISTINCT FROM release.promotion_discount_amount
                   OR app_order.tax_total_amount IS DISTINCT FROM release.tax_amount
                   OR app_order.net_total_amount IS DISTINCT FROM release.net_total_amount
                   OR (
                     app_order.status = 'RELEASED'
                     AND (
                       app_order.version IS DISTINCT FROM release.result_order_version
                       OR app_order.voided_by IS NOT NULL
                       OR app_order.voided_at IS NOT NULL
                       OR app_order.void_reason IS NOT NULL
                     )
                   )
                   OR (
                     app_order.status = 'VOIDED'
                     AND (
                       app_order.version IS DISTINCT FROM release.result_order_version + 1
                       OR app_order.voided_by IS NULL
                       OR app_order.voided_at IS NULL
                       OR NULLIF(BTRIM(app_order.void_reason), '') IS NULL
                     )
                   )
                 )
               )

            UNION ALL

            SELECT item.order_item_id::TEXT AS resource_id
            FROM opd_order_item AS item
            LEFT JOIN opd_order AS draft_order
              ON draft_order.order_id = item.order_id
             AND draft_order.encounter_id = item.encounter_id
             AND draft_order.clinic_id = item.clinic_id
             AND draft_order.branch_id = item.branch_id
            WHERE draft_order.order_id IS NULL
               OR item.display_order < 1
               OR item.source_type NOT IN ('PRODUCT', 'COURSE_ITEM')
               OR item.category NOT IN (
                 'MEDICINE', 'DRUG', 'TOOL', 'PRODUCT', 'CONSUMABLES', 'COURSE'
               )
               OR (
                 item.source_type = 'COURSE_ITEM'
                 AND item.category IS DISTINCT FROM 'COURSE'
               )
               OR (
                 item.source_type = 'PRODUCT'
                 AND item.category = 'COURSE'
               )
               OR NULLIF(BTRIM(item.source_id), '') IS NULL
               OR NULLIF(BTRIM(item.source_code), '') IS NULL
               OR NULLIF(BTRIM(item.name_snapshot), '') IS NULL
               OR NULLIF(BTRIM(item.unit_snapshot), '') IS NULL
               OR item.quantity <= 0
               OR item.unit_price_amount < 0
               OR item.pricing_source NOT IN ('BASE', 'PROMOTION')
               OR (
                 item.tax_type_snapshot IS NOT NULL
                 AND item.tax_type_snapshot NOT IN (
                   'INCLUDE_VAT', 'EXCLUDE_VAT', 'NO_VAT'
                 )
               )
               OR item.gross_amount IS DISTINCT FROM ROUND(
                 item.quantity * item.unit_price_amount,
                 2
               )
               OR item.discount_amount IS DISTINCT FROM 0::DECIMAL
               OR item.tax_amount IS DISTINCT FROM 0::DECIMAL
               OR item.net_amount IS DISTINCT FROM item.gross_amount
               OR item.status NOT IN ('ACTIVE', 'VOID')
               OR item.version < 1
               OR (
                 item.status = 'ACTIVE'
                 AND (
                   item.void_reason IS NOT NULL
                   OR item.voided_by IS NOT NULL
                   OR item.voided_at IS NOT NULL
                 )
               )
               OR (
                 item.status = 'VOID'
                 AND (item.voided_by IS NULL OR item.voided_at IS NULL)
               )
               OR (
                 item.category IN ('MEDICINE', 'DRUG')
                 AND NOT EXISTS (
                   SELECT 1
                   FROM opd_medication_instruction AS instruction
                   WHERE instruction.order_item_id = item.order_item_id
                     AND instruction.order_id = item.order_id
                     AND instruction.encounter_id = item.encounter_id
                     AND instruction.clinic_id = item.clinic_id
                     AND instruction.branch_id = item.branch_id
                 )
               )

            UNION ALL

            SELECT instruction.medication_instruction_id::TEXT AS resource_id
            FROM opd_medication_instruction AS instruction
            LEFT JOIN opd_order_item AS item
              ON item.order_item_id = instruction.order_item_id
             AND item.order_id = instruction.order_id
             AND item.encounter_id = instruction.encounter_id
             AND item.clinic_id = instruction.clinic_id
             AND item.branch_id = instruction.branch_id
            WHERE item.order_item_id IS NULL
               OR item.category NOT IN ('MEDICINE', 'DRUG')
               OR NULLIF(BTRIM(instruction.sig_text), '') IS NULL
               OR (
                 instruction.duration_value IS NULL
                 AND instruction.duration_unit IS NOT NULL
               )
               OR (
                 instruction.duration_value IS NOT NULL
                 AND (
                   instruction.duration_value <= 0
                   OR NULLIF(BTRIM(instruction.duration_unit), '') IS NULL
                 )
               )
          ) AS mismatch
        `,
        );
        const orderReleaseIntegrityMismatches = await tx.$queryRaw<CountRow[]>(
          Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM (
            SELECT release.release_id::TEXT AS resource_id
            FROM opd_order_release AS release
            INNER JOIN opd_order AS app_order
              ON app_order.order_id = release.order_id
             AND app_order.encounter_id = release.encounter_id
             AND app_order.clinic_id = release.clinic_id
             AND app_order.branch_id = release.branch_id
            LEFT JOIN opd_order_prescription_link AS prescription_link
              ON prescription_link.release_id = release.release_id
             AND prescription_link.order_id = release.order_id
             AND prescription_link.encounter_id = release.encounter_id
             AND prescription_link.clinic_id = release.clinic_id
             AND prescription_link.branch_id = release.branch_id
            LEFT JOIN opd_order_sale_link AS sale_link
              ON sale_link.release_id = release.release_id
             AND sale_link.order_id = release.order_id
             AND sale_link.encounter_id = release.encounter_id
             AND sale_link.clinic_id = release.clinic_id
             AND sale_link.branch_id = release.branch_id
            LEFT JOIN LATERAL (
              SELECT
                COUNT(*)::BIGINT AS item_count,
                COALESCE(SUM(item.gross_amount), 0) AS subtotal,
                COALESCE(SUM(item.discount_amount), 0) AS promotion_discount,
                COALESCE(SUM(item.tax_amount), 0) AS tax,
                COALESCE(SUM(item.net_amount), 0) AS net_total
              FROM opd_order_release_item AS item
              WHERE item.release_id = release.release_id
                AND item.order_id = release.order_id
                AND item.encounter_id = release.encounter_id
                AND item.clinic_id = release.clinic_id
                AND item.branch_id = release.branch_id
            ) AS release_totals ON TRUE
            LEFT JOIN LATERAL (
              SELECT COUNT(*)::BIGINT AS item_count
              FROM opd_order_item AS item
              WHERE item.order_id = release.order_id
                AND item.encounter_id = release.encounter_id
                AND item.clinic_id = release.clinic_id
                AND item.branch_id = release.branch_id
                AND item.status = 'ACTIVE'
            ) AS active_items ON TRUE
            LEFT JOIN LATERAL (
              SELECT COUNT(*)::BIGINT AS audit_count
              FROM audit_log AS audit
              WHERE audit.clinic_id = release.clinic_id
                AND audit.branch_id = release.branch_id
                AND audit.reference_type = 'OPD'
                AND audit.reference_id = release.encounter_id::TEXT
                AND audit.action = 'order.medication.release'
                AND audit.metadata ->> 'releaseId' = release.release_id::TEXT
            ) AS release_audit ON TRUE
            LEFT JOIN LATERAL (
              SELECT COUNT(*)::BIGINT AS audit_count
              FROM audit_log AS audit
              WHERE audit.clinic_id = release.clinic_id
                AND audit.branch_id = release.branch_id
                AND audit.reference_type = 'OPD'
                AND audit.reference_id = release.encounter_id::TEXT
                AND audit.action = 'order.medication-release.void'
                AND audit.metadata ->> 'releaseId' = release.release_id::TEXT
            ) AS void_audit ON TRUE
            WHERE prescription_link.prescription_link_id IS NULL
               OR sale_link.sale_link_id IS NULL
               OR prescription_link.customer_id IS DISTINCT FROM sale_link.customer_id
               OR release.source_order_version < 1
               OR release.result_order_version IS DISTINCT FROM release.source_order_version + 1
               OR release.currency IS DISTINCT FROM 'THB'
               OR release.pricing_policy IS DISTINCT FROM 'opd-medication-release-price-v1'
               OR release.tax_policy IS DISTINCT FROM 'opd-medication-no-vat-v1'
               OR release.safety_source IS DISTINCT FROM 'LEGACY_CUSTOMER_INFO_UNVERIFIED'
               OR release.tax_amount IS DISTINCT FROM 0::DECIMAL
               OR release.net_total_amount IS DISTINCT FROM ROUND(
                 release.subtotal_amount - release.promotion_discount_amount,
                 2
               )
               OR release_totals.item_count IS DISTINCT FROM active_items.item_count
               OR release_totals.item_count < 1
               OR release_totals.subtotal IS DISTINCT FROM release.subtotal_amount
               OR release_totals.promotion_discount IS DISTINCT FROM release.promotion_discount_amount
               OR release_totals.tax IS DISTINCT FROM release.tax_amount
               OR release_totals.net_total IS DISTINCT FROM release.net_total_amount
               OR release_audit.audit_count IS DISTINCT FROM 1::BIGINT
               OR (
                 app_order.status = 'VOIDED'
                 AND void_audit.audit_count IS DISTINCT FROM 1::BIGINT
               )

            UNION ALL

            SELECT release.release_id::TEXT AS resource_id
            FROM opd_order_release AS release
            INNER JOIN opd_order AS app_order
              ON app_order.order_id = release.order_id
             AND app_order.encounter_id = release.encounter_id
             AND app_order.clinic_id = release.clinic_id
             AND app_order.branch_id = release.branch_id
            LEFT JOIN opd_order_prescription_link AS prescription_link
              ON prescription_link.release_id = release.release_id
            LEFT JOIN opd_order_sale_link AS sale_link
              ON sale_link.release_id = release.release_id
            LEFT JOIN prescription AS legacy_prescription
              ON legacy_prescription.prescribe_id = prescription_link.legacy_prescribe_id
             AND legacy_prescription.clinic_id = release.clinic_id
             AND legacy_prescription.branch_id = release.branch_id
            LEFT JOIN sale_order AS legacy_sale
              ON legacy_sale.sale_order_id = sale_link.legacy_sale_order_id
             AND legacy_sale.clinic_id = release.clinic_id
             AND legacy_sale.branch_id = release.branch_id
            WHERE legacy_prescription.prescribe_id IS NULL
               OR legacy_sale.sale_order_id IS NULL
               OR legacy_prescription.opd_id IS DISTINCT FROM prescription_link.legacy_opd_id
               OR legacy_prescription.customer_id IS DISTINCT FROM prescription_link.customer_id
               OR legacy_prescription.sale_order_id IS DISTINCT FROM sale_link.legacy_sale_order_id
               OR legacy_prescription.user_create IS DISTINCT FROM release.prescriber_user_id
               OR legacy_sale.customer_id IS DISTINCT FROM sale_link.customer_id
               OR legacy_sale.total IS DISTINCT FROM release.subtotal_amount
               OR legacy_sale.promotion_discount IS DISTINCT FROM release.promotion_discount_amount
               OR legacy_sale.customer_discount IS DISTINCT FROM 0::DECIMAL
               OR legacy_sale.voucher_discount IS DISTINCT FROM 0::DECIMAL
               OR legacy_sale.extra_discount IS DISTINCT FROM 0::DECIMAL
               OR legacy_sale.subtotal IS DISTINCT FROM release.net_total_amount
               OR legacy_sale."totalDue" IS DISTINCT FROM release.net_total_amount
               OR legacy_sale.status IS DISTINCT FROM 'ACTIVE'
               OR (
                 app_order.status = 'RELEASED'
                 AND (
                   legacy_prescription.status NOT IN ('WAITING', 'SUCCESS')
                   OR legacy_sale.sale_order_status NOT IN ('PENDING', 'PARTAIL', 'PAID')
                 )
               )
               OR (
                 app_order.status = 'VOIDED'
                 AND (
                   legacy_prescription.status IS DISTINCT FROM 'CANCEL'
                   OR legacy_sale.sale_order_status IS DISTINCT FROM 'DELETED'
                 )
               )

            UNION ALL

            SELECT release_item.release_item_id::TEXT AS resource_id
            FROM opd_order_release_item AS release_item
            INNER JOIN opd_order_release AS release
              ON release.release_id = release_item.release_id
             AND release.order_id = release_item.order_id
             AND release.encounter_id = release_item.encounter_id
             AND release.clinic_id = release_item.clinic_id
             AND release.branch_id = release_item.branch_id
            INNER JOIN opd_order_prescription_link AS prescription_link
              ON prescription_link.release_id = release.release_id
            INNER JOIN opd_order_sale_link AS sale_link
              ON sale_link.release_id = release.release_id
            LEFT JOIN opd_order_item AS order_item
              ON order_item.order_item_id = release_item.order_item_id
             AND order_item.order_id = release_item.order_id
             AND order_item.encounter_id = release_item.encounter_id
             AND order_item.clinic_id = release_item.clinic_id
             AND order_item.branch_id = release_item.branch_id
            LEFT JOIN prescription_item AS legacy_prescription_item
              ON legacy_prescription_item.id = release_item.legacy_prescription_item_id
             AND legacy_prescription_item.prescribe_id = prescription_link.legacy_prescribe_id
            LEFT JOIN sale_order_item AS legacy_sale_item
              ON legacy_sale_item.sale_order_item_id = release_item.legacy_sale_order_item_id
             AND legacy_sale_item.sale_order_id = sale_link.legacy_sale_order_id
             AND legacy_sale_item.branch_id = release_item.branch_id
            WHERE order_item.order_item_id IS NULL
               OR release_item.source_type IS DISTINCT FROM 'PRODUCT'
               OR release_item.category NOT IN ('MEDICINE', 'DRUG')
               OR release_item.tax_type IS DISTINCT FROM 'NO_VAT'
               OR release_item.tax_amount IS DISTINCT FROM 0::DECIMAL
               OR release_item.gross_amount IS DISTINCT FROM ROUND(
                 release_item.quantity * release_item.base_unit_price_amount,
                 2
               )
               OR release_item.net_amount IS DISTINCT FROM ROUND(
                 release_item.quantity * release_item.unit_price_amount,
                 2
               )
               OR release_item.discount_amount IS DISTINCT FROM ROUND(
                 release_item.gross_amount - release_item.net_amount,
                 2
               )
               OR legacy_prescription_item.id IS NULL
               OR legacy_prescription_item.drug_id IS DISTINCT FROM release_item.source_id
               OR legacy_prescription_item.drug_name IS DISTINCT FROM release_item.name_snapshot
               OR legacy_prescription_item.price IS DISTINCT FROM release_item.base_unit_price_amount
               OR legacy_prescription_item.qty IS DISTINCT FROM release_item.quantity
               OR legacy_prescription_item.total_price IS DISTINCT FROM release_item.net_amount
               OR legacy_prescription_item.detail IS DISTINCT FROM release_item.sig_text
               OR legacy_prescription_item.lot_id IS DISTINCT FROM release_item.lot_id
               OR legacy_prescription_item.date_exp IS DISTINCT FROM release_item.expiry_at
               OR legacy_sale_item.sale_order_item_id IS NULL
               OR legacy_sale_item.item_id IS DISTINCT FROM release_item.source_id
               OR legacy_sale_item.item_name IS DISTINCT FROM release_item.name_snapshot
               OR legacy_sale_item.price_per_unit IS DISTINCT FROM release_item.base_unit_price_amount
               OR legacy_sale_item.quantity IS DISTINCT FROM release_item.quantity
               OR legacy_sale_item.discount IS DISTINCT FROM ROUND(
                 release_item.base_unit_price_amount - release_item.unit_price_amount,
                 2
               )
               OR legacy_sale_item.total IS DISTINCT FROM release_item.net_amount
               OR legacy_sale_item.net IS DISTINCT FROM release_item.unit_price_amount
               OR legacy_sale_item.lot_id IS DISTINCT FROM release_item.lot_id
               OR legacy_sale_item.promotion_price IS DISTINCT FROM CASE
                 WHEN release_item.pricing_source = 'PROMOTION'
                 THEN release_item.unit_price_amount
                 ELSE 0::DECIMAL
               END
          ) AS mismatch
        `,
        );
        const draftSnapshotIntegrityMismatches = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM opd_draft_snapshot AS snapshot
          LEFT JOIN opd_encounter AS encounter
            ON encounter.encounter_id = snapshot.source_encounter_id
           AND encounter.clinic_id = snapshot.clinic_id
           AND encounter.branch_id = snapshot.branch_id
          LEFT JOIN opd_draft_checkpoint AS checkpoint
            ON checkpoint.draft_checkpoint_id = snapshot.draft_checkpoint_id
           AND checkpoint.encounter_id = snapshot.source_encounter_id
           AND checkpoint.clinic_id = snapshot.clinic_id
           AND checkpoint.branch_id = snapshot.branch_id
          WHERE encounter.encounter_id IS NULL
             OR checkpoint.draft_checkpoint_id IS NULL
             OR encounter.customer_id IS DISTINCT FROM snapshot.customer_id
             OR snapshot.schema_version IS DISTINCT FROM 'opd-draft-copy-v1'
             OR JSONB_TYPEOF(snapshot.copyable_content) IS DISTINCT FROM 'object'
             OR JSONB_TYPEOF(snapshot.available_sections) IS DISTINCT FROM 'array'
             OR OCTET_LENGTH(snapshot.copyable_content::TEXT) > 1100000
             OR snapshot.content_sha256 !~ '^[0-9a-f]{64}$'
             OR snapshot.captured_by_user_id IS DISTINCT FROM checkpoint.actor_user_id
             OR snapshot.captured_at IS DISTINCT FROM checkpoint.created_at
             OR EXISTS (
               SELECT 1
               FROM JSONB_ARRAY_ELEMENTS_TEXT(snapshot.available_sections) AS code(value)
               WHERE code.value NOT IN (
                 'SYMPTOMS', 'INTAKE', 'DIAGNOSES',
                 'NOTE_CHIEF_COMPLAINT', 'NOTE_PHYSICAL_EXAMINATION',
                 'NOTE_DIAGNOSIS_NARRATIVE', 'NOTE_TREATMENT',
                 'NOTE_TREATMENT_PLAN', 'NOTE_ADDITIONAL_NOTES', 'NOTE_FREE_NOTE'
               )
             )
             OR JSONB_ARRAY_LENGTH(snapshot.available_sections) IS DISTINCT FROM (
               SELECT COUNT(DISTINCT code.value)::INTEGER
               FROM JSONB_ARRAY_ELEMENTS_TEXT(snapshot.available_sections) AS code(value)
             )
        `);
        const draftImportIntegrityMismatches = await tx.$queryRaw<CountRow[]>(
          Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM (
            SELECT draft_import.draft_import_id::TEXT AS resource_id
            FROM opd_draft_import AS draft_import
            LEFT JOIN opd_encounter AS target
              ON target.encounter_id = draft_import.target_encounter_id
             AND target.clinic_id = draft_import.clinic_id
             AND target.branch_id = draft_import.branch_id
            LEFT JOIN opd_draft_snapshot AS snapshot
              ON snapshot.draft_snapshot_id = draft_import.source_snapshot_id
             AND snapshot.clinic_id = draft_import.clinic_id
             AND snapshot.branch_id = draft_import.branch_id
             AND snapshot.customer_id = draft_import.customer_id
            LEFT JOIN LATERAL (
              SELECT COUNT(*)::INTEGER AS section_count
              FROM opd_draft_import_section AS section
              WHERE section.draft_import_id = draft_import.draft_import_id
            ) AS section_total ON TRUE
            WHERE target.encounter_id IS NULL
               OR snapshot.draft_snapshot_id IS NULL
               OR target.customer_id IS DISTINCT FROM draft_import.customer_id
               OR draft_import.source_encounter_id IS DISTINCT FROM snapshot.source_encounter_id
               OR draft_import.source_checkpoint_id IS DISTINCT FROM snapshot.draft_checkpoint_id
               OR draft_import.source_content_sha256 IS DISTINCT FROM snapshot.content_sha256
               OR draft_import.source_encounter_id = draft_import.target_encounter_id
               OR JSONB_TYPEOF(draft_import.selected_sections) IS DISTINCT FROM 'array'
               OR JSONB_ARRAY_LENGTH(draft_import.selected_sections) < 1
               OR JSONB_TYPEOF(draft_import.target_before_manifest) IS DISTINCT FROM 'object'
               OR JSONB_TYPEOF(draft_import.target_after_manifest) IS DISTINCT FROM 'object'
               OR draft_import.idempotency_key_hash !~ '^[0-9a-f]{64}$'
               OR section_total.section_count IS DISTINCT FROM JSONB_ARRAY_LENGTH(draft_import.selected_sections)

            UNION ALL

            SELECT section.draft_import_section_id::TEXT AS resource_id
            FROM opd_draft_import_section AS section
            LEFT JOIN opd_draft_import AS draft_import
              ON draft_import.draft_import_id = section.draft_import_id
             AND draft_import.target_encounter_id = section.target_encounter_id
             AND draft_import.clinic_id = section.clinic_id
             AND draft_import.branch_id = section.branch_id
            WHERE draft_import.draft_import_id IS NULL
               OR section.source_section_sha256 !~ '^[0-9a-f]{64}$'
               OR section.target_resource_version < 1
               OR section.section_code NOT IN (
                 'SYMPTOMS', 'INTAKE', 'DIAGNOSES',
                 'NOTE_CHIEF_COMPLAINT', 'NOTE_PHYSICAL_EXAMINATION',
                 'NOTE_DIAGNOSIS_NARRATIVE', 'NOTE_TREATMENT',
                 'NOTE_TREATMENT_PLAN', 'NOTE_ADDITIONAL_NOTES', 'NOTE_FREE_NOTE'
               )
               OR section.target_resource_type NOT IN (
                 'OPD_SYMPTOM_SECTION', 'OPD_INTAKE',
                 'OPD_DIAGNOSIS_SECTION', 'OPD_NOTE_SECTION'
               )
               OR (
                 section.review_status = 'REVIEW_REQUIRED'
                 AND (
                   section.reviewed_target_version IS NOT NULL
                   OR section.reviewed_by_user_id IS NOT NULL
                   OR section.reviewed_at IS NOT NULL
                 )
               )
               OR (
                 section.review_status = 'REVIEWED'
                 AND (
                   section.reviewed_target_version IS NULL
                   OR section.reviewed_by_user_id IS NULL
                   OR section.reviewed_at IS NULL
                 )
               )
               OR section.review_status NOT IN ('REVIEW_REQUIRED', 'REVIEWED')
          ) AS mismatch
        `,
        );
        const clinicalFinalizationIntegrityMismatches = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM opd_clinical_finalization AS finalization
          LEFT JOIN opd_encounter AS encounter
            ON encounter.encounter_id = finalization.encounter_id
           AND encounter.clinic_id = finalization.clinic_id
           AND encounter.branch_id = finalization.branch_id
          LEFT JOIN opd_queue_ticket AS ticket
            ON ticket.queue_ticket_id = finalization.queue_ticket_id
           AND ticket.clinic_id = finalization.clinic_id
           AND ticket.branch_id = finalization.branch_id
          WHERE encounter.encounter_id IS NULL
             OR ticket.queue_ticket_id IS NULL
             OR encounter.queue_ticket_id IS DISTINCT FROM finalization.queue_ticket_id
             OR encounter.customer_id IS DISTINCT FROM ticket.customer_id
             OR encounter.appointment_id IS DISTINCT FROM ticket.appointment_id
             OR encounter.workflow_status NOT IN ('POST_VISIT', 'CLOSED')
             OR encounter.clinical_record_status IS DISTINCT FROM 'FINALIZED'
             OR encounter.version < finalization.result_encounter_version
             OR encounter.finalized_by IS DISTINCT FROM finalization.finalized_by
             OR encounter.finalized_at IS DISTINCT FROM finalization.finalized_at
             OR finalization.source_encounter_version < 1
             OR finalization.result_encounter_version
                  IS DISTINCT FROM finalization.source_encounter_version + 1
             OR finalization.source_queue_ticket_version < 1
             OR finalization.result_queue_ticket_version
                  IS DISTINCT FROM finalization.source_queue_ticket_version + 1
             OR finalization.source_queue_step IS DISTINCT FROM 'IN_SERVICE'
             OR finalization.result_queue_step IS DISTINCT FROM 'DISPENSING'
             OR finalization.manifest_schema
                  IS DISTINCT FROM 'opd-clinical-finalization-v1'
             OR JSONB_TYPEOF(finalization.resource_manifest) IS DISTINCT FROM 'object'
             OR finalization.resource_manifest ->> 'schema'
                  IS DISTINCT FROM finalization.manifest_schema
             OR finalization.resource_manifest ->> 'encounterId'
                  IS DISTINCT FROM finalization.encounter_id::TEXT
             OR (finalization.resource_manifest ->> 'encounterVersion')::INTEGER
                  IS DISTINCT FROM finalization.source_encounter_version
             OR finalization.resource_manifest #>> '{queue,id}'
                  IS DISTINCT FROM finalization.queue_ticket_id::TEXT
             OR (finalization.resource_manifest #>> '{queue,version}')::INTEGER
                  IS DISTINCT FROM finalization.source_queue_ticket_version
             OR finalization.resource_manifest #>> '{queue,currentStep}'
                  IS DISTINCT FROM finalization.source_queue_step
             OR finalization.manifest_hash !~ '^[0-9a-f]{64}$'
             OR finalization.idempotency_key_hash !~ '^[0-9a-f]{64}$'
             OR NOT EXISTS (
               SELECT 1
               FROM queue_transition AS transition
               WHERE transition.queue_ticket_id = finalization.queue_ticket_id
                 AND transition.clinic_id = finalization.clinic_id
                 AND transition.branch_id = finalization.branch_id
                 AND transition.encounter_id = finalization.encounter_id
                 AND transition.from_step = finalization.source_queue_step
                 AND transition.to_step = finalization.result_queue_step
                 AND transition.expected_version = finalization.source_queue_ticket_version
                 AND transition.result_version = finalization.result_queue_ticket_version
             )
             OR NOT EXISTS (
               SELECT 1
               FROM audit_log AS audit
               WHERE audit.clinic_id = finalization.clinic_id
                 AND audit.branch_id = finalization.branch_id
                 AND audit.reference_type = 'OPD'
                 AND audit.reference_id = finalization.encounter_id::TEXT
                 AND audit.action = 'clinical.finalize'
             )
             OR NOT EXISTS (
               SELECT 1
               FROM audit_log AS audit
               WHERE audit.clinic_id = finalization.clinic_id
                 AND audit.branch_id = finalization.branch_id
                 AND audit.reference_type = 'QUEUE'
                 AND audit.reference_id = finalization.queue_ticket_id::TEXT
                 AND audit.action = 'enter-dispensing-after-treatment'
             )
        `);
        const courseReservationIntegrityMismatches = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM (
            SELECT 'root:' || reservation.reservation_id::TEXT AS resource_id
            FROM opd_course_reservation AS reservation
            LEFT JOIN opd_encounter AS encounter
              ON encounter.encounter_id = reservation.encounter_id
             AND encounter.clinic_id = reservation.clinic_id
             AND encounter.branch_id = reservation.branch_id
            LEFT JOIN opd AS legacy_opd
              ON legacy_opd.opd_id = reservation.legacy_opd_id
             AND legacy_opd.clinic_id = reservation.clinic_id
             AND legacy_opd.branch_id = reservation.branch_id
             AND legacy_opd.customer_id = reservation.customer_id
            LEFT JOIN service_usage AS legacy_usage
              ON legacy_usage.service_usage_id = reservation.legacy_service_usage_id
             AND legacy_usage.branch_id = reservation.legacy_service_usage_branch_id
             AND legacy_usage.clinic_id = reservation.clinic_id
            LEFT JOIN LATERAL (
              SELECT COUNT(*)::INTEGER AS item_count
              FROM opd_course_reservation_item AS item
              WHERE item.reservation_id = reservation.reservation_id
                AND item.encounter_id = reservation.encounter_id
                AND item.clinic_id = reservation.clinic_id
                AND item.branch_id = reservation.branch_id
            ) AS item_total ON TRUE
            LEFT JOIN LATERAL (
              SELECT COUNT(*)::INTEGER AS audit_count
              FROM audit_log AS audit
              WHERE audit.clinic_id = reservation.clinic_id
                AND audit.branch_id = reservation.branch_id
                AND audit.reference_type = 'OPD'
                AND audit.reference_id = reservation.encounter_id::TEXT
                AND audit.action = 'course.entitlement.reserve'
                AND audit.metadata ->> 'reservationId' = reservation.reservation_id::TEXT
            ) AS reserve_audit ON TRUE
            LEFT JOIN LATERAL (
              SELECT COUNT(*)::INTEGER AS audit_count
              FROM audit_log AS audit
              WHERE audit.clinic_id = reservation.clinic_id
                AND audit.branch_id = reservation.branch_id
                AND audit.reference_type = 'OPD'
                AND audit.reference_id = reservation.encounter_id::TEXT
                AND audit.action = 'course.entitlement-reservation.void'
                AND audit.metadata ->> 'reservationId' = reservation.reservation_id::TEXT
            ) AS void_audit ON TRUE
            LEFT JOIN LATERAL (
              SELECT COUNT(*)::INTEGER AS claim_count
              FROM api_idempotency AS claim
              WHERE claim.clinic_id = reservation.clinic_id
                AND claim.branch_id = reservation.branch_id
                AND claim.operation = 'opd.course-entitlement.reserve.v1'
                AND claim.state = 'COMPLETED'
                AND claim.resource_type = 'OPD_COURSE_RESERVATION'
                AND claim.resource_id = reservation.reservation_id::TEXT
                AND claim.request_hash = reservation.request_hash
            ) AS reserve_claim ON TRUE
            LEFT JOIN LATERAL (
              SELECT COUNT(*)::INTEGER AS claim_count
              FROM api_idempotency AS claim
              WHERE claim.clinic_id = reservation.clinic_id
                AND claim.branch_id = reservation.branch_id
                AND claim.operation = 'opd.course-entitlement-reservation.void.v1'
                AND claim.state = 'COMPLETED'
                AND claim.resource_type = 'OPD_COURSE_RESERVATION_VOID'
                AND claim.resource_id = reservation.reservation_id::TEXT
            ) AS void_claim ON TRUE
            WHERE encounter.encounter_id IS NULL
               OR encounter.customer_id IS DISTINCT FROM reservation.customer_id
               OR legacy_opd.opd_id IS NULL
               OR legacy_usage.service_usage_id IS NULL
               OR reservation.legacy_service_usage_branch_id
                    IS DISTINCT FROM reservation.branch_id
               OR legacy_usage.customer_id IS DISTINCT FROM reservation.customer_id
               OR legacy_usage.customer_owner_id IS DISTINCT FROM reservation.customer_id
               OR legacy_usage.service_usage_status IS DISTINCT FROM CASE
                    WHEN reservation.status IN ('RESERVED', 'VOIDED') THEN 'PENDING'::service_usage_status
                    WHEN reservation.status IN ('USED', 'COMPENSATED') THEN 'APPROVED'::service_usage_status
                  END
               OR item_total.item_count < 1
               OR item_total.item_count
                    IS DISTINCT FROM JSONB_ARRAY_LENGTH(reservation.source_balance_manifest)
               OR reserve_audit.audit_count IS DISTINCT FROM 1
               OR reserve_claim.claim_count IS DISTINCT FROM 1
               OR (
                 reservation.status = 'RESERVED'
                 AND (
                   legacy_usage.status IS DISTINCT FROM 'ACTIVE'
                   OR legacy_usage.verify_at IS NOT NULL
                   OR legacy_usage.verify_by IS NOT NULL
                   OR legacy_usage.document_url IS NOT NULL
                   OR legacy_opd.management_item
                        IS DISTINCT FROM reservation.legacy_service_usage_id
                   OR void_audit.audit_count IS DISTINCT FROM 0
                   OR void_claim.claim_count IS DISTINCT FROM 0
                 )
               )
                OR (
                  reservation.status = 'VOIDED'
                 AND (
                   legacy_usage.status IS DISTINCT FROM 'DELETED'
                   OR legacy_opd.management_item = reservation.legacy_service_usage_id
                   OR void_audit.audit_count IS DISTINCT FROM 1
                   OR void_claim.claim_count IS DISTINCT FROM 1
                  )
                )
                OR (
                  reservation.status = 'USED'
                  AND (
                    legacy_usage.status IS DISTINCT FROM 'ACTIVE'
                    OR legacy_usage.verify_at IS DISTINCT FROM reservation.used_at::TIMESTAMP
                    OR legacy_usage.verify_by IS DISTINCT FROM reservation.used_by_user_id
                    OR legacy_usage.document_url IS NULL
                    OR legacy_opd.management_item
                         IS DISTINCT FROM reservation.legacy_service_usage_id
                    OR void_audit.audit_count IS DISTINCT FROM 0
                    OR void_claim.claim_count IS DISTINCT FROM 0
                  )
                )
                OR (
                  reservation.status = 'COMPENSATED'
                  AND (
                    legacy_usage.status IS DISTINCT FROM 'DELETED'
                    OR legacy_usage.verify_at IS DISTINCT FROM reservation.used_at::TIMESTAMP
                    OR legacy_usage.verify_by IS DISTINCT FROM reservation.used_by_user_id
                    OR legacy_usage.document_url IS NULL
                    OR legacy_opd.management_item = reservation.legacy_service_usage_id
                    OR void_audit.audit_count IS DISTINCT FROM 0
                    OR void_claim.claim_count IS DISTINCT FROM 0
                  )
                )

            UNION ALL

            SELECT 'item:' || item.reservation_item_id::TEXT AS resource_id
            FROM opd_course_reservation_item AS item
            LEFT JOIN opd_course_reservation AS reservation
              ON reservation.reservation_id = item.reservation_id
             AND reservation.encounter_id = item.encounter_id
             AND reservation.clinic_id = item.clinic_id
             AND reservation.branch_id = item.branch_id
            LEFT JOIN customer_coures AS entitlement
              ON entitlement.clinic_id = item.clinic_id
             AND entitlement.branch_id = item.purchase_branch_id
             AND entitlement.customer_id = item.customer_id
             AND entitlement.sale_order_id = item.sale_order_id
             AND entitlement.item_id = item.course_item_id
             AND entitlement.expire_date = item.entitlement_expire_at
            LEFT JOIN sale_order AS purchase
              ON purchase.sale_order_id = item.sale_order_id
             AND purchase.branch_id = item.purchase_branch_id
             AND purchase.clinic_id = item.clinic_id
            LEFT JOIN service_usage_item AS legacy_item
              ON legacy_item.service_usage_item_id = item.legacy_service_usage_item_id
             AND legacy_item.service_usage_id = reservation.legacy_service_usage_id
             AND legacy_item.branch_id = item.branch_id
            LEFT JOIN customer_course_usage_log AS usage_log
              ON usage_log.id = item.legacy_usage_log_id
             AND usage_log.service_usage_id = reservation.legacy_service_usage_id
             AND usage_log.branch_id = item.branch_id
             AND usage_log.clinic_id = item.clinic_id
            WHERE reservation.reservation_id IS NULL
               OR item.customer_id IS DISTINCT FROM reservation.customer_id
               OR item.purchase_branch_id IS DISTINCT FROM item.branch_id
               OR entitlement.sale_order_id IS NULL
               OR purchase.sale_order_id IS NULL
               OR purchase.customer_id IS DISTINCT FROM item.customer_id
               OR legacy_item.service_usage_item_id IS NULL
               OR legacy_item.course_id IS DISTINCT FROM item.course_item_id
               OR legacy_item.item_id IS NOT NULL
               OR legacy_item.quantity IS DISTINCT FROM item.reserved_amount
               OR legacy_item.expire_date IS DISTINCT FROM item.entitlement_expire_at
               OR (
                 SELECT COUNT(*)
                 FROM service_usage_item AS candidate
                 WHERE candidate.service_usage_id = reservation.legacy_service_usage_id
                   AND candidate.branch_id = item.branch_id
               ) IS DISTINCT FROM (
                 SELECT COUNT(*)
                 FROM opd_course_reservation_item AS candidate
                 WHERE candidate.reservation_id = item.reservation_id
               )
               OR (
                 reservation.status = 'RESERVED'
                 AND (
                   usage_log.id IS NULL
                   OR usage_log.customer_id IS DISTINCT FROM item.customer_id
                   OR usage_log.item_id IS DISTINCT FROM item.course_item_id
                   OR usage_log.amount IS DISTINCT FROM item.reserved_amount
                   OR usage_log.status IS DISTINCT FROM 'RESERVED'
                   OR usage_log.expire_date IS DISTINCT FROM item.entitlement_expire_at
                   OR usage_log.course_usage_type IS DISTINCT FROM 'SERVICE_USAGE'
                 )
               )
                OR (
                  reservation.status = 'VOIDED'
                  AND usage_log.id IS NOT NULL
                )
                OR (
                  reservation.status = 'USED'
                  AND (
                    usage_log.id IS NULL
                    OR usage_log.customer_id IS DISTINCT FROM item.customer_id
                    OR usage_log.item_id IS DISTINCT FROM item.course_item_id
                    OR usage_log.amount IS DISTINCT FROM item.reserved_amount
                    OR usage_log.status IS DISTINCT FROM 'USED'
                    OR usage_log.expire_date IS DISTINCT FROM item.entitlement_expire_at
                    OR usage_log.course_usage_type IS DISTINCT FROM 'SERVICE_USAGE'
                  )
                )
                OR (
                  reservation.status = 'COMPENSATED'
                  AND usage_log.id IS NOT NULL
                )

            UNION ALL

            SELECT 'component:' || component.reservation_component_id::TEXT AS resource_id
            FROM opd_course_reservation_component AS component
            LEFT JOIN opd_course_reservation_item AS item
              ON item.reservation_item_id = component.reservation_item_id
             AND item.reservation_id = component.reservation_id
             AND item.encounter_id = component.encounter_id
             AND item.clinic_id = component.clinic_id
             AND item.branch_id = component.branch_id
            LEFT JOIN service_usage_item_product AS legacy_component
              ON legacy_component.service_usage_item_id = item.legacy_service_usage_item_id
             AND legacy_component.branch_id = component.branch_id
             AND legacy_component.item_id = component.product_id
            WHERE item.reservation_item_id IS NULL
               OR legacy_component.service_usage_item_id IS NULL
               OR legacy_component.service_usage_id IS DISTINCT FROM (
                 SELECT reservation.legacy_service_usage_id
                 FROM opd_course_reservation AS reservation
                 WHERE reservation.reservation_id = component.reservation_id
               )
               OR legacy_component.quantity IS DISTINCT FROM component.total_quantity
               OR legacy_component.lot_id IS DISTINCT FROM COALESCE(
                 (
                   SELECT verified.actual_lot_id
                   FROM opd_course_verification_component AS verified
                   WHERE verified.reservation_component_id =
                         component.reservation_component_id
                 ),
                 component.lot_id
               )
               OR (
                 SELECT COUNT(*)
                 FROM service_usage_item_product AS candidate
                 WHERE candidate.service_usage_item_id = item.legacy_service_usage_item_id
                   AND candidate.branch_id = component.branch_id
               ) IS DISTINCT FROM (
                 SELECT COUNT(*)
                 FROM opd_course_reservation_component AS candidate
                 WHERE candidate.reservation_item_id = component.reservation_item_id
               )

            UNION ALL

            SELECT 'operator:' || operator.reservation_operator_id::TEXT AS resource_id
            FROM opd_course_reservation_operator AS operator
            LEFT JOIN opd_course_reservation_item AS item
              ON item.reservation_item_id = operator.reservation_item_id
             AND item.reservation_id = operator.reservation_id
             AND item.encounter_id = operator.encounter_id
             AND item.clinic_id = operator.clinic_id
             AND item.branch_id = operator.branch_id
            LEFT JOIN opd_course_reservation AS reservation
              ON reservation.reservation_id = operator.reservation_id
            WHERE item.reservation_item_id IS NULL
               OR reservation.reservation_id IS NULL
               OR NOT EXISTS (
                 SELECT 1
                 FROM course_operator_user AS legacy_operator
                 WHERE legacy_operator.service_usage_id = reservation.legacy_service_usage_id
                   AND legacy_operator.branch_id = operator.branch_id
                   AND legacy_operator.user_id = operator.user_id
                   AND legacy_operator.operator_type::TEXT = operator.operator_type
               )
               OR NOT EXISTS (
                 SELECT 1
                 FROM service_usage_item_commission AS legacy_commission
                 WHERE legacy_commission.service_usage_item_id = item.legacy_service_usage_item_id
                   AND legacy_commission.service_usage_id = reservation.legacy_service_usage_id
                   AND legacy_commission.branch_id = operator.branch_id
                   AND legacy_commission.role::TEXT = operator.role_id
                   AND legacy_commission.operator_type::TEXT = operator.operator_type
                   AND legacy_commission.commission = operator.commission_amount
                   AND legacy_commission.unit::TEXT = operator.commission_unit
               )

            UNION ALL

            SELECT 'inventory:' || reservation.reservation_id::TEXT AS resource_id
            FROM opd_course_reservation AS reservation
            INNER JOIN inventory_log AS movement
              ON movement.document_id = reservation.legacy_service_usage_id
             AND movement.branch_id = reservation.branch_id
            WHERE reservation.status IN ('RESERVED', 'VOIDED')

            UNION ALL

            SELECT 'negative-balance:' || item.reservation_item_id::TEXT AS resource_id
            FROM opd_course_reservation_item AS item
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(log.amount), 0::DECIMAL) AS consumed
              FROM customer_course_usage_log AS log
              WHERE log.clinic_id = item.clinic_id
                AND log.customer_id = item.customer_id
                AND log.item_id = item.course_item_id
                AND log.expire_date = item.entitlement_expire_at
                AND log.status IN ('RESERVED', 'USED')
            ) AS balance ON TRUE
            WHERE item.entitlement_amount - balance.consumed < 0

            UNION ALL

            SELECT 'duplicate-active:' || encounter_id::TEXT AS resource_id
            FROM opd_course_reservation
            WHERE status = 'RESERVED'
            GROUP BY clinic_id, branch_id, encounter_id
            HAVING COUNT(*) > 1
          ) AS mismatch
        `);
        const missingCourseVerificationPermissions = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          WITH required(permission_id) AS (
            VALUES ('OPD_COURSE_VERIFY'), ('OPD_COURSE_COMPENSATE')
          )
          SELECT COUNT(*)::BIGINT AS count
          FROM required
          LEFT JOIN permission
            ON permission.permission_id = required.permission_id
          WHERE permission.permission_id IS NULL
        `);
        const unexpectedCourseVerificationDefaultGrants = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
            SELECT COUNT(*)::BIGINT AS count
            FROM default_permission
            WHERE permission_id IN (
              'OPD_COURSE_VERIFY',
              'OPD_COURSE_COMPENSATE'
            )
          `);
        const courseVerificationIntegrityMismatches = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM (
            SELECT
              'verification:' || verification.verification_id::TEXT AS resource_id
            FROM opd_course_verification AS verification
            LEFT JOIN opd_course_reservation AS reservation
              ON reservation.reservation_id = verification.reservation_id
             AND reservation.clinic_id = verification.clinic_id
             AND reservation.branch_id = verification.branch_id
             AND reservation.encounter_id = verification.encounter_id
            LEFT JOIN service_usage AS legacy_usage
              ON legacy_usage.service_usage_id =
                 verification.legacy_service_usage_id
             AND legacy_usage.branch_id =
                 verification.legacy_service_usage_branch_id
             AND legacy_usage.clinic_id = verification.clinic_id
            LEFT JOIN opd AS legacy_opd
              ON legacy_opd.opd_id = verification.legacy_opd_id
             AND legacy_opd.clinic_id = verification.clinic_id
             AND legacy_opd.branch_id = verification.branch_id
            LEFT JOIN customer_file AS signature_file
              ON signature_file.file_id = verification.signature_file_id
             AND signature_file.clinic_id = verification.clinic_id
             AND signature_file.branch_id = verification.branch_id
             AND signature_file.customer_id = verification.customer_id
            LEFT JOIN customer_file AS pdf_file
              ON pdf_file.file_id = verification.pdf_file_id
             AND pdf_file.clinic_id = verification.clinic_id
             AND pdf_file.branch_id = verification.branch_id
             AND pdf_file.customer_id = verification.customer_id
            WHERE reservation.reservation_id IS NULL
               OR reservation.customer_id IS DISTINCT FROM verification.customer_id
               OR reservation.legacy_opd_id IS DISTINCT FROM verification.legacy_opd_id
               OR reservation.legacy_service_usage_id
                    IS DISTINCT FROM verification.legacy_service_usage_id
               OR reservation.status NOT IN ('USED', 'COMPENSATED')
               OR reservation.used_by_user_id
                    IS DISTINCT FROM verification.verified_by_user_id
               OR reservation.used_at IS DISTINCT FROM verification.verified_at
               OR verification.signer_customer_id
                    IS DISTINCT FROM verification.customer_id
               OR verification.manifest_schema
                    IS DISTINCT FROM 'opd-course-verification-v1'
               OR verification.verification_manifest ->> 'schema'
                    IS DISTINCT FROM verification.manifest_schema
               OR verification.verification_manifest ->> 'clinicId'
                    IS DISTINCT FROM verification.clinic_id
               OR verification.verification_manifest ->> 'branchId'
                    IS DISTINCT FROM verification.branch_id
               OR verification.verification_manifest ->> 'encounterId'
                    IS DISTINCT FROM verification.encounter_id::TEXT
               OR verification.verification_manifest ->> 'reservationId'
                    IS DISTINCT FROM verification.reservation_id::TEXT
               OR verification.verification_manifest ->> 'customerId'
                    IS DISTINCT FROM verification.customer_id
               OR verification.verification_manifest ->> 'signatureHash'
                    IS DISTINCT FROM verification.signature_hash
               OR verification.verification_manifest ->> 'acknowledgementHash'
                    IS DISTINCT FROM verification.acknowledgement_hash
               OR verification.verification_manifest ->> 'renderTemplate'
                    IS DISTINCT FROM verification.render_template
               OR (verification.verification_manifest ->> 'renderVersion')::INTEGER
                    IS DISTINCT FROM verification.render_version
               OR legacy_usage.service_usage_id IS NULL
               OR legacy_usage.customer_id IS DISTINCT FROM verification.customer_id
               OR legacy_usage.customer_owner_id
                    IS DISTINCT FROM verification.customer_id
               OR legacy_usage.service_usage_status IS DISTINCT FROM 'APPROVED'
               OR legacy_usage.verify_by
                    IS DISTINCT FROM verification.verified_by_user_id
               OR legacy_usage.verify_at
                    IS DISTINCT FROM verification.verified_at::TIMESTAMP
               OR legacy_usage.document_url
                    IS DISTINCT FROM verification.legacy_document_url
               OR legacy_usage.status IS DISTINCT FROM CASE
                    WHEN reservation.status = 'USED' THEN 'ACTIVE'::record_status
                    WHEN reservation.status = 'COMPENSATED' THEN 'DELETED'::record_status
                  END
               OR legacy_opd.opd_id IS NULL
               OR (
                 reservation.status = 'USED'
                 AND legacy_opd.management_item
                     IS DISTINCT FROM verification.legacy_service_usage_id
               )
               OR (
                 reservation.status = 'COMPENSATED'
                 AND legacy_opd.management_item =
                     verification.legacy_service_usage_id
               )
               OR signature_file.file_id IS NULL
               OR signature_file.mime_type IS DISTINCT FROM 'image/png'
               OR signature_file.file_size
                    IS DISTINCT FROM verification.signature_bytes
               OR signature_file.status IS DISTINCT FROM 'ACTIVE'
               OR signature_file.public_url IS NOT NULL
               OR pdf_file.file_id IS NULL
               OR pdf_file.mime_type IS DISTINCT FROM 'application/pdf'
               OR pdf_file.file_size IS DISTINCT FROM verification.pdf_bytes
               OR pdf_file.status IS DISTINCT FROM 'ACTIVE'
               OR pdf_file.public_url IS NOT NULL
               OR (
                 SELECT COUNT(*)
                 FROM opd_course_verification_component AS component
                 WHERE component.verification_id = verification.verification_id
               ) IS DISTINCT FROM (
                 SELECT COUNT(*)
                 FROM opd_course_reservation_component AS component
                 WHERE component.reservation_id = verification.reservation_id
               )
               OR EXISTS (
                 SELECT 1
                 FROM opd_course_reservation_component AS component
                 WHERE component.reservation_id = verification.reservation_id
                   AND NOT EXISTS (
                     SELECT 1
                     FROM opd_course_verification_component AS verified
                     WHERE verified.verification_id =
                           verification.verification_id
                       AND verified.reservation_component_id =
                           component.reservation_component_id
                   )
               )
               OR (
                 reservation.status = 'USED'
                 AND EXISTS (
                   SELECT 1
                   FROM opd_course_reservation_item AS item
                   LEFT JOIN customer_course_usage_log AS usage_log
                     ON usage_log.id = item.legacy_usage_log_id
                    AND usage_log.service_usage_id =
                        verification.legacy_service_usage_id
                    AND usage_log.branch_id = verification.branch_id
                    AND usage_log.clinic_id = verification.clinic_id
                   WHERE item.reservation_id = verification.reservation_id
                     AND (
                       usage_log.id IS NULL
                       OR usage_log.status IS DISTINCT FROM 'USED'
                       OR usage_log.amount IS DISTINCT FROM item.reserved_amount
                     )
                 )
               )
               OR (
                 reservation.status = 'COMPENSATED'
                 AND EXISTS (
                   SELECT 1
                   FROM opd_course_reservation_item AS item
                   INNER JOIN customer_course_usage_log AS usage_log
                     ON usage_log.id = item.legacy_usage_log_id
                    AND usage_log.service_usage_id =
                        verification.legacy_service_usage_id
                    AND usage_log.branch_id = verification.branch_id
                   WHERE item.reservation_id = verification.reservation_id
                 )
               )
               OR (
                 SELECT COUNT(*)
                 FROM api_idempotency AS claim
                 WHERE claim.clinic_id = verification.clinic_id
                   AND claim.branch_id = verification.branch_id
                   AND claim.operation =
                       'opd.course-verification.verify.v1'
                   AND claim.state = 'COMPLETED'
                   AND claim.resource_type = 'OPD_COURSE_VERIFICATION'
                   AND claim.resource_id = verification.verification_id::TEXT
                   AND claim.request_hash = verification.request_hash
               ) IS DISTINCT FROM 1
               OR (
                 SELECT COUNT(*)
                 FROM audit_log AS audit
                 WHERE audit.clinic_id = verification.clinic_id
                   AND audit.branch_id = verification.branch_id
                   AND audit.reference_type = 'OPD'
                   AND audit.reference_id = verification.encounter_id::TEXT
                   AND audit.action = 'course.verify'
                   AND audit.metadata ->> 'verificationId' =
                       verification.verification_id::TEXT
               ) IS DISTINCT FROM 1

            UNION ALL

            SELECT
              'component:' ||
              component.verification_component_id::TEXT AS resource_id
            FROM opd_course_verification_component AS component
            LEFT JOIN opd_course_verification AS verification
              ON verification.verification_id = component.verification_id
             AND verification.reservation_id = component.reservation_id
             AND verification.clinic_id = component.clinic_id
             AND verification.branch_id = component.branch_id
             AND verification.encounter_id = component.encounter_id
            LEFT JOIN opd_course_reservation_component AS reserved_component
              ON reserved_component.reservation_component_id =
                 component.reservation_component_id
             AND reserved_component.reservation_id = component.reservation_id
             AND reserved_component.clinic_id = component.clinic_id
             AND reserved_component.branch_id = component.branch_id
             AND reserved_component.encounter_id = component.encounter_id
            LEFT JOIN opd_course_reservation_item AS reserved_item
              ON reserved_item.reservation_item_id =
                 reserved_component.reservation_item_id
             AND reserved_item.reservation_id = component.reservation_id
             AND reserved_item.clinic_id = component.clinic_id
             AND reserved_item.branch_id = component.branch_id
             AND reserved_item.encounter_id = component.encounter_id
            LEFT JOIN inventory_log AS movement
              ON movement.inventory_log_id = component.inventory_log_id
             AND movement.branch_id = component.branch_id
            LEFT JOIN service_usage_item_product AS legacy_component
              ON legacy_component.service_usage_item_id =
                 reserved_item.legacy_service_usage_item_id
             AND legacy_component.item_id = component.product_id
             AND legacy_component.branch_id = component.branch_id
            WHERE verification.verification_id IS NULL
               OR reserved_component.reservation_component_id IS NULL
               OR reserved_component.product_id
                    IS DISTINCT FROM component.product_id
               OR reserved_component.lot_id
                    IS DISTINCT FROM component.original_lot_id
               OR reserved_component.total_quantity
                    IS DISTINCT FROM component.quantity
               OR legacy_component.lot_id
                    IS DISTINCT FROM component.actual_lot_id
               OR movement.inventory_log_id IS NULL
               OR movement.document_id
                    IS DISTINCT FROM verification.legacy_service_usage_id
               OR movement.item_id IS DISTINCT FROM component.product_id
               OR movement.lot_id IS DISTINCT FROM component.actual_lot_id
               OR movement.stock_in IS DISTINCT FROM 0::DECIMAL
               OR movement.stock_out IS DISTINCT FROM (
                 SELECT SUM(peer.quantity)
                 FROM opd_course_verification_component AS peer
                 WHERE peer.verification_id = component.verification_id
                   AND peer.inventory_log_id = component.inventory_log_id
               )
               OR movement.current_stock IS DISTINCT FROM (
                 SELECT MIN(peer.after_total_stock)
                 FROM opd_course_verification_component AS peer
                 WHERE peer.verification_id = component.verification_id
                   AND peer.inventory_log_id = component.inventory_log_id
               )

            UNION ALL

            SELECT
              'compensation:' ||
              request.compensation_request_id::TEXT AS resource_id
            FROM opd_course_compensation_request AS request
            LEFT JOIN opd_course_verification AS verification
              ON verification.verification_id = request.verification_id
             AND verification.reservation_id = request.reservation_id
             AND verification.clinic_id = request.clinic_id
             AND verification.branch_id = request.branch_id
             AND verification.encounter_id = request.encounter_id
            LEFT JOIN opd_course_reservation AS reservation
              ON reservation.reservation_id = request.reservation_id
             AND reservation.clinic_id = request.clinic_id
             AND reservation.branch_id = request.branch_id
             AND reservation.encounter_id = request.encounter_id
            LEFT JOIN service_usage_request_cancel AS legacy_request
              ON legacy_request.service_usage_id =
                 request.legacy_service_usage_id
             AND legacy_request.branch_id =
                 request.legacy_service_usage_branch_id
            WHERE verification.verification_id IS NULL
               OR reservation.reservation_id IS NULL
               OR request.legacy_service_usage_id
                    IS DISTINCT FROM verification.legacy_service_usage_id
               OR legacy_request.service_usage_id IS NULL
               OR legacy_request.reason_id IS DISTINCT FROM request.reason_code
               OR legacy_request.description
                    IS DISTINCT FROM request.reason_description
               OR legacy_request.created_by
                    IS DISTINCT FROM request.requested_by_user_id
               OR legacy_request.status::TEXT IS DISTINCT FROM request.status
               OR (
                 request.status IN ('PENDING', 'REJECTED')
                 AND reservation.status IS DISTINCT FROM 'USED'
               )
               OR (
                 request.status = 'APPROVED'
                 AND reservation.status IS DISTINCT FROM 'COMPENSATED'
               )
               OR (
                 request.status IN ('REJECTED', 'APPROVED')
                 AND (
                   legacy_request.approve_by
                       IS DISTINCT FROM request.reviewed_by_user_id
                   OR legacy_request.approve_at
                       IS DISTINCT FROM request.reviewed_at::TIMESTAMP
                 )
               )
               OR (
                 SELECT COUNT(*)
                 FROM api_idempotency AS claim
                 WHERE claim.clinic_id = request.clinic_id
                   AND claim.branch_id = request.branch_id
                   AND claim.operation =
                       'opd.course-verification.compensation-request.v1'
                   AND claim.state = 'COMPLETED'
                   AND claim.resource_type =
                       'OPD_COURSE_COMPENSATION_REQUEST'
                   AND claim.resource_id =
                       request.compensation_request_id::TEXT
                   AND claim.request_hash = request.request_hash
               ) IS DISTINCT FROM 1
               OR (
                 SELECT COUNT(*)
                 FROM audit_log AS audit
                 WHERE audit.clinic_id = request.clinic_id
                   AND audit.branch_id = request.branch_id
                   AND audit.reference_type = 'OPD'
                   AND audit.reference_id = request.encounter_id::TEXT
                   AND audit.action = 'course.compensation.request'
                   AND audit.metadata ->> 'compensationRequestId' =
                       request.compensation_request_id::TEXT
               ) IS DISTINCT FROM 1
               OR (
                 request.status = 'REJECTED'
                 AND (
                   (
                     SELECT COUNT(*)
                     FROM api_idempotency AS claim
                     WHERE claim.clinic_id = request.clinic_id
                       AND claim.branch_id = request.branch_id
                       AND claim.operation =
                           'opd.course-verification.compensation-reject.v1'
                       AND claim.state = 'COMPLETED'
                       AND claim.resource_type =
                           'OPD_COURSE_COMPENSATION_REJECT'
                       AND claim.resource_id =
                           request.compensation_request_id::TEXT
                       AND claim.request_hash = request.review_request_hash
                   ) IS DISTINCT FROM 1
                   OR (
                     SELECT COUNT(*)
                     FROM audit_log AS audit
                     WHERE audit.clinic_id = request.clinic_id
                       AND audit.branch_id = request.branch_id
                       AND audit.action = 'course.compensation.reject'
                       AND audit.metadata ->> 'compensationRequestId' =
                           request.compensation_request_id::TEXT
                   ) IS DISTINCT FROM 1
                 )
               )
               OR (
                 request.status = 'APPROVED'
                 AND (
                   (
                     SELECT COUNT(*)
                     FROM api_idempotency AS claim
                     WHERE claim.clinic_id = request.clinic_id
                       AND claim.branch_id = request.branch_id
                       AND claim.operation =
                           'opd.course-verification.compensation-approve.v1'
                       AND claim.state = 'COMPLETED'
                       AND claim.resource_type =
                           'OPD_COURSE_COMPENSATION_APPROVE'
                       AND claim.resource_id =
                           request.compensation_request_id::TEXT
                       AND claim.request_hash = request.review_request_hash
                   ) IS DISTINCT FROM 1
                   OR (
                     SELECT COUNT(*)
                     FROM audit_log AS audit
                     WHERE audit.clinic_id = request.clinic_id
                       AND audit.branch_id = request.branch_id
                       AND audit.action = 'course.compensation.approve'
                       AND audit.metadata ->> 'compensationRequestId' =
                           request.compensation_request_id::TEXT
                   ) IS DISTINCT FROM 1
                 )
               )

            UNION ALL

            SELECT
              'compensation-component:' ||
              component.compensation_component_id::TEXT AS resource_id
            FROM opd_course_compensation_component AS component
            LEFT JOIN opd_course_compensation_request AS request
              ON request.compensation_request_id =
                 component.compensation_request_id
             AND request.verification_id = component.verification_id
             AND request.reservation_id = component.reservation_id
             AND request.clinic_id = component.clinic_id
             AND request.branch_id = component.branch_id
             AND request.encounter_id = component.encounter_id
            LEFT JOIN opd_course_verification_component AS verified
              ON verified.verification_component_id =
                 component.verification_component_id
             AND verified.verification_id = component.verification_id
             AND verified.reservation_id = component.reservation_id
             AND verified.clinic_id = component.clinic_id
             AND verified.branch_id = component.branch_id
             AND verified.encounter_id = component.encounter_id
            LEFT JOIN inventory_log AS original_movement
              ON original_movement.inventory_log_id =
                 component.original_inventory_log_id
             AND original_movement.branch_id = component.branch_id
            LEFT JOIN inventory_log AS inverse_movement
              ON inverse_movement.inventory_log_id =
                 component.inverse_inventory_log_id
             AND inverse_movement.branch_id = component.branch_id
            WHERE request.compensation_request_id IS NULL
               OR request.status IS DISTINCT FROM 'APPROVED'
               OR verified.verification_component_id IS NULL
               OR component.product_id IS DISTINCT FROM verified.product_id
               OR component.lot_id IS DISTINCT FROM verified.actual_lot_id
               OR component.quantity IS DISTINCT FROM verified.quantity
               OR component.original_inventory_log_id
                    IS DISTINCT FROM verified.inventory_log_id
               OR original_movement.inventory_log_id IS NULL
               OR original_movement.stock_in IS DISTINCT FROM 0::DECIMAL
               OR inverse_movement.inventory_log_id IS NULL
               OR inverse_movement.document_id
                    IS DISTINCT FROM request.adjustment_document_id
               OR inverse_movement.item_id IS DISTINCT FROM component.product_id
               OR inverse_movement.lot_id IS DISTINCT FROM component.lot_id
               OR inverse_movement.stock_out IS DISTINCT FROM 0::DECIMAL
               OR inverse_movement.stock_in IS DISTINCT FROM (
                 SELECT SUM(peer.quantity)
                 FROM opd_course_compensation_component AS peer
                 WHERE peer.compensation_request_id =
                       component.compensation_request_id
                   AND peer.inverse_inventory_log_id =
                       component.inverse_inventory_log_id
               )
               OR inverse_movement.current_stock IS DISTINCT FROM (
                 SELECT MAX(peer.after_total_stock)
                 FROM opd_course_compensation_component AS peer
                 WHERE peer.compensation_request_id =
                       component.compensation_request_id
                   AND peer.inverse_inventory_log_id =
                       component.inverse_inventory_log_id
               )

            UNION ALL

            SELECT
              'missing-compensation-component:' ||
              verified.verification_component_id::TEXT AS resource_id
            FROM opd_course_compensation_request AS request
            INNER JOIN opd_course_verification_component AS verified
              ON verified.verification_id = request.verification_id
            LEFT JOIN opd_course_compensation_component AS compensated
              ON compensated.compensation_request_id =
                 request.compensation_request_id
             AND compensated.verification_component_id =
                 verified.verification_component_id
            WHERE request.status = 'APPROVED'
              AND compensated.compensation_component_id IS NULL
          ) AS mismatch
        `);
        const legacyCourseEntitlementAnomalies = await tx.$queryRaw<CountRow[]>(
          Prisma.sql`
          WITH entitlement AS (
            SELECT
              clinic_id,
              customer_id,
              item_id,
              expire_date,
              COUNT(*)::BIGINT AS entitlement_count,
              SUM(COALESCE(amount, 0::DECIMAL)) AS purchased,
              BOOL_OR(amount IS NULL OR amount <= 0) AS non_positive
            FROM customer_coures
            GROUP BY clinic_id, customer_id, item_id, expire_date
          ), usage AS (
            SELECT
              clinic_id,
              customer_id,
              item_id,
              expire_date,
              SUM(CASE WHEN status = 'RESERVED' THEN COALESCE(amount, 0::DECIMAL) ELSE 0::DECIMAL END) AS reserved,
              SUM(CASE WHEN status = 'USED' THEN COALESCE(amount, 0::DECIMAL) ELSE 0::DECIMAL END) AS used,
              BOOL_OR(amount IS NULL OR amount <= 0) AS non_positive
            FROM customer_course_usage_log
            WHERE status IN ('RESERVED', 'USED')
            GROUP BY clinic_id, customer_id, item_id, expire_date
          )
          SELECT COUNT(*)::BIGINT AS count
          FROM entitlement
          FULL JOIN usage
            ON usage.clinic_id = entitlement.clinic_id
           AND usage.customer_id = entitlement.customer_id
           AND usage.item_id = entitlement.item_id
           AND usage.expire_date = entitlement.expire_date
          WHERE entitlement.clinic_id IS NULL
             OR entitlement.entitlement_count IS DISTINCT FROM 1
             OR entitlement.non_positive
             OR usage.non_positive
             OR entitlement.purchased - COALESCE(usage.reserved, 0::DECIMAL)
                  - COALESCE(usage.used, 0::DECIMAL) < 0
        `,
        );
        const missingFinalizationPermission = await tx.$queryRaw<CountRow[]>(
          Prisma.sql`
          SELECT CASE WHEN EXISTS (
            SELECT 1
            FROM permission
            WHERE permission_id = 'OPD_FINALIZE'
          ) THEN 0 ELSE 1 END::BIGINT AS count
        `,
        );
        const unexpectedFinalizationDefaultGrants = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM default_permission
          WHERE permission_id = 'OPD_FINALIZE'
        `);
        const unsafeLegacyOpdNumbers = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM opd
          WHERE opd_id ~ '^OPDV2-[0-9]{8}-[0-9]{6,}$'
            AND SUBSTRING(opd_id FROM 16)::NUMERIC >= 9007199254740991
        `);
        const duplicateActiveDailyWalkIns = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT COUNT(*)::BIGINT AS count
          FROM (
            SELECT 1
            FROM opd_encounter
            WHERE encounter_type = 'WALK_IN'
              AND appointment_id IS NULL
              AND workflow_status IN ('OPEN', 'POST_VISIT')
            GROUP BY clinic_id, branch_id, customer_id, business_date
            HAVING COUNT(*) > 1
          ) AS duplicate_scope
        `);
        const missingActiveWalkInIndex = await tx.$queryRaw<
          CountRow[]
        >(Prisma.sql`
          SELECT CASE WHEN EXISTS (
            SELECT 1
            FROM pg_index AS index_meta
            INNER JOIN pg_class AS index_relation
              ON index_relation.oid = index_meta.indexrelid
            INNER JOIN pg_class AS table_relation
              ON table_relation.oid = index_meta.indrelid
            INNER JOIN pg_namespace AS table_namespace
              ON table_namespace.oid = table_relation.relnamespace
            WHERE table_namespace.nspname = CURRENT_SCHEMA()
              AND table_relation.relname = 'opd_encounter'
              AND index_relation.relname = 'opd_encounter_active_daily_walk_in_uq'
              AND index_meta.indisunique
              AND index_meta.indpred IS NOT NULL
              AND POSITION(
                'clinic_id, branch_id, customer_id, business_date'
                IN PG_GET_INDEXDEF(index_meta.indexrelid)
              ) > 0
              AND POSITION('encounter_type' IN PG_GET_EXPR(index_meta.indpred, index_meta.indrelid)) > 0
              AND POSITION('WALK_IN' IN PG_GET_EXPR(index_meta.indpred, index_meta.indrelid)) > 0
              AND POSITION('appointment_id IS NULL' IN PG_GET_EXPR(index_meta.indpred, index_meta.indrelid)) > 0
              AND POSITION('workflow_status' IN PG_GET_EXPR(index_meta.indpred, index_meta.indrelid)) > 0
              AND POSITION('OPEN' IN PG_GET_EXPR(index_meta.indpred, index_meta.indrelid)) > 0
              AND POSITION('POST_VISIT' IN PG_GET_EXPR(index_meta.indpred, index_meta.indrelid)) > 0
          ) THEN 0 ELSE 1 END::BIGINT AS count
        `);
        const sequenceLag = await tx.$queryRaw<SequenceLagRow[]>(Prisma.sql`
          WITH required_queue AS (
            SELECT
              clinic_id,
              branch_id,
              'QUEUE'::TEXT AS number_kind,
              TO_CHAR(business_date, 'YYYYMMDD') AS period_key,
              MAX(queue_sequence)::BIGINT + 1 AS required_next_value
            FROM opd_queue_ticket
            GROUP BY clinic_id, branch_id, business_date
          ), required_legacy_opd AS (
            SELECT
              clinic_id,
              branch_id,
              'LEGACY_OPD'::TEXT AS number_kind,
              SUBSTRING(opd_id FROM 7 FOR 8) AS period_key,
              MAX(SUBSTRING(opd_id FROM 16)::BIGINT) + 1 AS required_next_value
            FROM opd
            WHERE opd_id ~ '^OPDV2-[0-9]{8}-[0-9]{6,16}$'
              AND SUBSTRING(opd_id FROM 16)::NUMERIC < 9007199254740991
            GROUP BY clinic_id, branch_id, SUBSTRING(opd_id FROM 7 FOR 8)
          ), required AS (
            SELECT * FROM required_queue
            UNION ALL
            SELECT * FROM required_legacy_opd
          )
          SELECT
            required.clinic_id,
            required.branch_id,
            required.number_kind,
            required.period_key,
            sequence.next_value,
            required.required_next_value
          FROM required
          LEFT JOIN opd_number_sequence AS sequence
            ON sequence.clinic_id = required.clinic_id
           AND sequence.branch_id = required.branch_id
           AND sequence.number_kind = required.number_kind
           AND sequence.period_key = required.period_key
          WHERE sequence.number_sequence_id IS NULL
             OR sequence.next_value < required.required_next_value
          ORDER BY
            required.clinic_id,
            required.branch_id,
            required.number_kind,
            required.period_key
        `);
        const courseVerificationEvidenceObjects = await tx.$queryRaw<
          EvidenceObjectRow[]
        >(Prisma.sql`
          SELECT
            verification.verification_id::TEXT,
            signature_file.bucket_name AS signature_bucket_name,
            signature_file.object_key AS signature_object_key,
            verification.signature_bytes,
            verification.signature_hash,
            pdf_file.bucket_name AS pdf_bucket_name,
            pdf_file.object_key AS pdf_object_key,
            verification.pdf_bytes,
            verification.pdf_hash
          FROM opd_course_verification AS verification
          INNER JOIN customer_file AS signature_file
            ON signature_file.file_id = verification.signature_file_id
           AND signature_file.clinic_id = verification.clinic_id
           AND signature_file.branch_id = verification.branch_id
          INNER JOIN customer_file AS pdf_file
            ON pdf_file.file_id = verification.pdf_file_id
           AND pdf_file.clinic_id = verification.clinic_id
           AND pdf_file.branch_id = verification.branch_id
          ORDER BY verification.verification_id
        `);

        return {
          queueTickets: ticketCount,
          encounters: encounterCount,
          intakeRows: intakeCount,
          orderRows: orderCount,
          orderItemRows: orderItemCount,
          medicationInstructionRows: medicationInstructionCount,
          orderReleaseRows: orderReleaseCount,
          orderReleaseItemRows: orderReleaseItemCount,
          orderPrescriptionLinkRows: orderPrescriptionLinkCount,
          orderSaleLinkRows: orderSaleLinkCount,
          courseReservationRows: courseReservationCount,
          courseReservationItemRows: courseReservationItemCount,
          courseReservationComponentRows: courseReservationComponentCount,
          courseReservationOperatorRows: courseReservationOperatorCount,
          courseVerificationRows: courseVerificationCount,
          courseVerificationComponentRows: courseVerificationComponentCount,
          courseCompensationRequestRows: courseCompensationRequestCount,
          courseCompensationComponentRows: courseCompensationComponentCount,
          draftSnapshotRows: draftSnapshotCount,
          draftImportRows: draftImportCount,
          draftImportSectionRows: draftImportSectionCount,
          clinicalFinalizationRows: clinicalFinalizationCount,
          validLegacyPairsMissingTicket: Number(
            candidateCounts[0]?.valid_missing ?? 0n,
          ),
          invalidDateLegacyPairs: Number(
            candidateCounts[0]?.invalid_date ?? 0n,
          ),
          scopeMismatchedLegacyPairs: Number(scopeMismatches[0]?.count ?? 0n),
          legacyAppointmentsExcludedWithoutSameScopeQueueStatus: Number(
            excludedLegacyAppointments[0]?.count ?? 0n,
          ),
          ticketAppointmentIdentityMismatches: Number(
            ticketAppointmentMismatches[0]?.count ?? 0n,
          ),
          encounterTicketIdentityMismatches: Number(
            encounterTicketMismatches[0]?.count ?? 0n,
          ),
          encounterLegacyOpdMismatches: Number(
            encounterLegacyOpdMismatches[0]?.count ?? 0n,
          ),
          missingPhaseOneRoleGrants: Number(
            missingPhaseOneRoleGrants[0]?.count ?? 0n,
          ),
          missingCorrectionPermission: Number(
            missingCorrectionPermission[0]?.count ?? 0n,
          ),
          correctionChainMismatches: Number(
            correctionChainMismatches[0]?.count ?? 0n,
          ),
          clinicalNoteIntegrityMismatches: Number(
            clinicalNoteIntegrityMismatches[0]?.count ?? 0n,
          ),
          intakeIntegrityMismatches: Number(
            intakeIntegrityMismatches[0]?.count ?? 0n,
          ),
          orderIntegrityMismatches: Number(
            orderIntegrityMismatches[0]?.count ?? 0n,
          ),
          orderReleaseIntegrityMismatches: Number(
            orderReleaseIntegrityMismatches[0]?.count ?? 0n,
          ),
          courseReservationIntegrityMismatches: Number(
            courseReservationIntegrityMismatches[0]?.count ?? 0n,
          ),
          courseVerificationIntegrityMismatches: Number(
            courseVerificationIntegrityMismatches[0]?.count ?? 0n,
          ),
          missingCourseVerificationPermissions: Number(
            missingCourseVerificationPermissions[0]?.count ?? 0n,
          ),
          unexpectedCourseVerificationDefaultGrants: Number(
            unexpectedCourseVerificationDefaultGrants[0]?.count ?? 0n,
          ),
          legacyCourseEntitlementAnomalies: Number(
            legacyCourseEntitlementAnomalies[0]?.count ?? 0n,
          ),
          draftSnapshotIntegrityMismatches: Number(
            draftSnapshotIntegrityMismatches[0]?.count ?? 0n,
          ),
          draftImportIntegrityMismatches: Number(
            draftImportIntegrityMismatches[0]?.count ?? 0n,
          ),
          clinicalFinalizationIntegrityMismatches: Number(
            clinicalFinalizationIntegrityMismatches[0]?.count ?? 0n,
          ),
          missingFinalizationPermission: Number(
            missingFinalizationPermission[0]?.count ?? 0n,
          ),
          unexpectedFinalizationDefaultGrants: Number(
            unexpectedFinalizationDefaultGrants[0]?.count ?? 0n,
          ),
          unsafeLegacyOpdNumbers: Number(
            unsafeLegacyOpdNumbers[0]?.count ?? 0n,
          ),
          duplicateActiveDailyWalkIns: Number(
            duplicateActiveDailyWalkIns[0]?.count ?? 0n,
          ),
          missingActiveWalkInUniquenessIndex: Number(
            missingActiveWalkInIndex[0]?.count ?? 0n,
          ),
          laggingQueueSequences: sequenceLag.map((row) => ({
            clinicId: row.clinic_id,
            branchId: row.branch_id,
            numberKind: row.number_kind,
            periodKey: row.period_key,
            nextValue: row.next_value?.toString() ?? null,
            requiredNextValue: row.required_next_value.toString(),
          })),
          courseVerificationEvidenceObjects,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 5_000,
        timeout: 30_000,
      },
    );

    const storage = new StorageService();
    let courseVerificationEvidenceObjectMismatches = 0;
    for (const evidence of report.courseVerificationEvidenceObjects) {
      const objects = [
        {
          bucketName: evidence.signature_bucket_name,
          objectKey: evidence.signature_object_key,
          expectedBytes: evidence.signature_bytes,
          expectedHash: evidence.signature_hash,
        },
        {
          bucketName: evidence.pdf_bucket_name,
          objectKey: evidence.pdf_object_key,
          expectedBytes: evidence.pdf_bytes,
          expectedHash: evidence.pdf_hash,
        },
      ];
      for (const object of objects) {
        try {
          const bytes = await storage.readObject({
            bucketName: object.bucketName,
            objectKey: object.objectKey,
          });
          const hash = createHash("sha256").update(bytes).digest("hex");
          if (
            bytes.length !== object.expectedBytes ||
            hash !== object.expectedHash
          ) {
            courseVerificationEvidenceObjectMismatches += 1;
          }
        } catch {
          courseVerificationEvidenceObjectMismatches += 1;
        }
      }
    }
    const {
      courseVerificationEvidenceObjects: _privateEvidenceCoordinates,
      ...databaseReport
    } = report;
    const finalReport = {
      ...databaseReport,
      courseVerificationEvidenceObjectMismatches,
    };

    process.stdout.write(`${JSON.stringify(finalReport, null, 2)}\n`);
    if (
      report.validLegacyPairsMissingTicket > 0 ||
      report.invalidDateLegacyPairs > 0 ||
      report.scopeMismatchedLegacyPairs > 0 ||
      report.ticketAppointmentIdentityMismatches > 0 ||
      report.encounterTicketIdentityMismatches > 0 ||
      report.encounterLegacyOpdMismatches > 0 ||
      report.missingPhaseOneRoleGrants > 0 ||
      report.missingCorrectionPermission > 0 ||
      report.correctionChainMismatches > 0 ||
      report.clinicalNoteIntegrityMismatches > 0 ||
      report.intakeIntegrityMismatches > 0 ||
      report.orderIntegrityMismatches > 0 ||
      report.orderReleaseIntegrityMismatches > 0 ||
      report.courseReservationIntegrityMismatches > 0 ||
      report.courseVerificationIntegrityMismatches > 0 ||
      report.missingCourseVerificationPermissions > 0 ||
      report.unexpectedCourseVerificationDefaultGrants > 0 ||
      courseVerificationEvidenceObjectMismatches > 0 ||
      report.draftSnapshotIntegrityMismatches > 0 ||
      report.draftImportIntegrityMismatches > 0 ||
      report.clinicalFinalizationIntegrityMismatches > 0 ||
      report.missingFinalizationPermission > 0 ||
      report.unexpectedFinalizationDefaultGrants > 0 ||
      report.unsafeLegacyOpdNumbers > 0 ||
      report.duplicateActiveDailyWalkIns > 0 ||
      report.missingActiveWalkInUniquenessIndex > 0 ||
      report.laggingQueueSequences.length > 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
