-- OPD V2 Phase 1 compatibility backfill.
--
-- Creates stable app-owned queue tickets only for an unambiguous legacy pair:
-- appointment + queue_status with the same clinic, branch, and appointment ID.
-- Invalid legacy date strings and mismatched rows are deliberately skipped;
-- the API continues to expose those rows with queueTicketId = null so they can
-- be reconciled instead of guessed. No legacy HealthX row is changed.
--
-- Run this after 011_create_opd_v2_foundation.sql, with OPD V2 disabled and
-- legacy appointment/queue writes placed in a maintenance window. The SHARE
-- locks below enforce that window at the database boundary: they wait for an
-- in-flight legacy writer to finish and reject/hold new writers while the
-- statement takes its source snapshot. This prevents a legacy queue transition
-- from committing after the snapshot and leaving a newly imported ticket stale.
-- They do not alter or write either legacy table.
--
-- Acquire legacy source locks before app-owned destination locks. Current
-- application transactions write the legacy appointment/queue projection before
-- the V2 ticket, so this ordering also avoids lock inversion during rollout.
-- The app-owned locks prevent a live V2 allocator from receiving a duplicate
-- daily number while the backfill calculates its offsets.

BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE "appointment", "queue_status" IN SHARE MODE;
LOCK TABLE "opd_queue_ticket" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "opd_number_sequence" IN SHARE ROW EXCLUSIVE MODE;

WITH "candidate_raw" AS (
    SELECT
        "a"."clinic_id",
        "a"."branch_id",
        "a"."customer_id",
        "a"."appointment_id",
        "a"."user_create",
        "a"."date_appointment",
        CASE
            WHEN "a"."date_appointment" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
             AND SUBSTRING("a"."date_appointment", 1, 4)::INTEGER BETWEEN 1 AND 9999
             AND SUBSTRING("a"."date_appointment", 6, 2)::INTEGER BETWEEN 1 AND 12
             AND SUBSTRING("a"."date_appointment", 9, 2)::INTEGER BETWEEN 1 AND 31
            THEN CASE
                WHEN SUBSTRING("a"."date_appointment", 9, 2)::INTEGER <= EXTRACT(
                    DAY FROM (
                        MAKE_DATE(
                            SUBSTRING("a"."date_appointment", 1, 4)::INTEGER,
                            SUBSTRING("a"."date_appointment", 6, 2)::INTEGER,
                            1
                        ) + INTERVAL '1 month - 1 day'
                    )
                )
                THEN MAKE_DATE(
                    SUBSTRING("a"."date_appointment", 1, 4)::INTEGER,
                    SUBSTRING("a"."date_appointment", 6, 2)::INTEGER,
                    SUBSTRING("a"."date_appointment", 9, 2)::INTEGER
                )
                ELSE NULL
            END
            ELSE NULL
        END AS "business_date",
        "qs"."queue_status_id",
        "qs"."current_step",
        "qs"."entered_at",
        "qs"."created_at"
    FROM "appointment" AS "a"
    INNER JOIN "queue_status" AS "qs"
        ON "qs"."appointment_id" = "a"."appointment_id"
       AND "qs"."clinic_id" = "a"."clinic_id"
       AND "qs"."branch_id" = "a"."branch_id"
    LEFT JOIN "opd_queue_ticket" AS "ticket"
        ON "ticket"."clinic_id" = "a"."clinic_id"
       AND "ticket"."branch_id" = "a"."branch_id"
       AND "ticket"."appointment_id" = "a"."appointment_id"
    WHERE "ticket"."queue_ticket_id" IS NULL
),
"candidate" AS (
    SELECT *
    FROM "candidate_raw"
    WHERE "business_date" IS NOT NULL
      AND TO_CHAR("business_date", 'YYYY-MM-DD') = "date_appointment"
),
"scope_max" AS (
    SELECT
        "clinic_id",
        "branch_id",
        "business_date",
        MAX("queue_sequence") AS "max_sequence"
    FROM "opd_queue_ticket"
    GROUP BY "clinic_id", "branch_id", "business_date"
),
"numbered" AS (
    SELECT
        "candidate".*,
        COALESCE("scope_max"."max_sequence", 0)
          + ROW_NUMBER() OVER (
                PARTITION BY
                    "candidate"."clinic_id",
                    "candidate"."branch_id",
                    "candidate"."business_date"
                ORDER BY
                    "candidate"."entered_at",
                    "candidate"."appointment_id"
            ) AS "allocated_sequence"
    FROM "candidate"
    LEFT JOIN "scope_max"
        ON "scope_max"."clinic_id" = "candidate"."clinic_id"
       AND "scope_max"."branch_id" = "candidate"."branch_id"
       AND "scope_max"."business_date" = "candidate"."business_date"
)
INSERT INTO "opd_queue_ticket" (
    "queue_ticket_id",
    "clinic_id",
    "branch_id",
    "customer_id",
    "appointment_id",
    "legacy_queue_status_id",
    "source_type",
    "business_date",
    "current_step",
    "entered_at",
    "queue_sequence",
    "display_number",
    "version",
    "created_by",
    "created_at",
    "updated_at"
)
SELECT
    (
        SUBSTRING(MD5(
            'opd-v2-ticket:'
            || "numbered"."clinic_id" || ':'
            || "numbered"."branch_id" || ':'
            || "numbered"."appointment_id"
        ), 1, 8) || '-'
        || SUBSTRING(MD5(
            'opd-v2-ticket:'
            || "numbered"."clinic_id" || ':'
            || "numbered"."branch_id" || ':'
            || "numbered"."appointment_id"
        ), 9, 4) || '-'
        || SUBSTRING(MD5(
            'opd-v2-ticket:'
            || "numbered"."clinic_id" || ':'
            || "numbered"."branch_id" || ':'
            || "numbered"."appointment_id"
        ), 13, 4) || '-'
        || SUBSTRING(MD5(
            'opd-v2-ticket:'
            || "numbered"."clinic_id" || ':'
            || "numbered"."branch_id" || ':'
            || "numbered"."appointment_id"
        ), 17, 4) || '-'
        || SUBSTRING(MD5(
            'opd-v2-ticket:'
            || "numbered"."clinic_id" || ':'
            || "numbered"."branch_id" || ':'
            || "numbered"."appointment_id"
        ), 21, 12)
    )::UUID,
    "numbered"."clinic_id",
    "numbered"."branch_id",
    "numbered"."customer_id",
    "numbered"."appointment_id",
    "numbered"."queue_status_id",
    'APPOINTMENT',
    "numbered"."business_date",
    "numbered"."current_step",
    "numbered"."entered_at" AT TIME ZONE 'UTC',
    "numbered"."allocated_sequence"::INTEGER,
    'Q' || LPAD("numbered"."allocated_sequence"::TEXT, 3, '0'),
    1,
    "numbered"."user_create",
    "numbered"."created_at" AT TIME ZONE 'UTC',
    CURRENT_TIMESTAMP
FROM "numbered"
ON CONFLICT ("clinic_id", "branch_id", "appointment_id") DO NOTHING;

-- Bring the atomic allocator forward to one past every imported maximum. This
-- also repairs a missing/stale sequence row without ever moving it backwards.
INSERT INTO "opd_number_sequence" (
    "number_sequence_id",
    "clinic_id",
    "branch_id",
    "number_kind",
    "period_key",
    "next_value",
    "version",
    "created_at",
    "updated_at"
)
SELECT
    (
        SUBSTRING(MD5(
            'opd-v2-sequence:'
            || "ticket"."clinic_id" || ':'
            || "ticket"."branch_id" || ':'
            || TO_CHAR("ticket"."business_date", 'YYYYMMDD')
        ), 1, 8) || '-'
        || SUBSTRING(MD5(
            'opd-v2-sequence:'
            || "ticket"."clinic_id" || ':'
            || "ticket"."branch_id" || ':'
            || TO_CHAR("ticket"."business_date", 'YYYYMMDD')
        ), 9, 4) || '-'
        || SUBSTRING(MD5(
            'opd-v2-sequence:'
            || "ticket"."clinic_id" || ':'
            || "ticket"."branch_id" || ':'
            || TO_CHAR("ticket"."business_date", 'YYYYMMDD')
        ), 13, 4) || '-'
        || SUBSTRING(MD5(
            'opd-v2-sequence:'
            || "ticket"."clinic_id" || ':'
            || "ticket"."branch_id" || ':'
            || TO_CHAR("ticket"."business_date", 'YYYYMMDD')
        ), 17, 4) || '-'
        || SUBSTRING(MD5(
            'opd-v2-sequence:'
            || "ticket"."clinic_id" || ':'
            || "ticket"."branch_id" || ':'
            || TO_CHAR("ticket"."business_date", 'YYYYMMDD')
        ), 21, 12)
    )::UUID,
    "ticket"."clinic_id",
    "ticket"."branch_id",
    'QUEUE',
    TO_CHAR("ticket"."business_date", 'YYYYMMDD'),
    MAX("ticket"."queue_sequence")::BIGINT + 1,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "opd_queue_ticket" AS "ticket"
GROUP BY
    "ticket"."clinic_id",
    "ticket"."branch_id",
    "ticket"."business_date"
ON CONFLICT ("clinic_id", "branch_id", "number_kind", "period_key")
DO UPDATE SET
    "next_value" = GREATEST(
        "opd_number_sequence"."next_value",
        EXCLUDED."next_value"
    ),
    "version" = CASE
        WHEN "opd_number_sequence"."next_value" < EXCLUDED."next_value"
        THEN "opd_number_sequence"."version" + 1
        ELSE "opd_number_sequence"."version"
    END,
    "updated_at" = CASE
        WHEN "opd_number_sequence"."next_value" < EXCLUDED."next_value"
        THEN CURRENT_TIMESTAMP
        ELSE "opd_number_sequence"."updated_at"
    END;

COMMIT;

-- Reconciliation queries for the operator (read-only; run separately before
-- and after the maintenance window). The application must remain disabled and
-- queue writers must remain quiesced until the post-backfill verifier passes:
--
-- Valid same-scope pairs still missing a ticket (expected: 0):
-- SELECT COUNT(*) FROM appointment a JOIN queue_status qs
--   ON qs.appointment_id = a.appointment_id
--  AND qs.clinic_id = a.clinic_id AND qs.branch_id = a.branch_id
-- LEFT JOIN opd_queue_ticket t ON t.clinic_id = a.clinic_id
--  AND t.branch_id = a.branch_id AND t.appointment_id = a.appointment_id
-- WHERE t.queue_ticket_id IS NULL
--   AND a.date_appointment ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
--   AND TO_CHAR(TO_DATE(a.date_appointment, 'YYYY-MM-DD'), 'YYYY-MM-DD')
--       = a.date_appointment;
--
-- Scope-mismatched legacy pairs requiring remediation:
-- SELECT COUNT(*) FROM appointment a JOIN queue_status qs
--   ON qs.appointment_id = a.appointment_id
-- WHERE qs.clinic_id <> a.clinic_id OR qs.branch_id <> a.branch_id;
