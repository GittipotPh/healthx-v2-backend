import { Prisma } from "@prisma/client";
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

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const report = await prisma.$transaction(
      async (tx) => {
        const ticketCount = await tx.opd_queue_ticket.count();
        const encounterCount = await tx.opd_encounter.count();
        const intakeCount = await tx.opd_intake.count();
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

        return {
          queueTickets: ticketCount,
          encounters: encounterCount,
          intakeRows: intakeCount,
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
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 5_000,
        timeout: 30_000,
      },
    );

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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
